/**
 * Keeps the brands coherent with each other and with everything that cannot
 * import lib/brand.ts.
 *
 * One codebase serves more than one business (see lib/brand.ts). The places a
 * brand difference can go quietly wrong are the ones that hold their own copy:
 * firestore.rules, which is not TypeScript; lib/messages.ts and
 * lib/emailNotice.ts, which stay import-free for this runner; the CSS tokens,
 * which the PDF writer and map overlays cannot read; and the generated assets.
 * Nothing in the build fails when one of those drifts. So this test does.
 *
 * Modules that pick their brand at load time are imported a second time with
 * a query string after NEXT_PUBLIC_BRAND is set — a distinct URL is a fresh
 * module instance, so the same file can be read as each brand in one run.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, describe } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const { SERVICE_TYPES } = await import("../lib/types.ts");
const { SERVICE_LABEL, SERVICE_SHORT_LABEL } = await import("../lib/status.ts");
const { BRAND_IDS, brandProfile, asBrandId } = await import("../lib/brand.ts");
const { brandDeploymentProblem, GRIME_BUSTERS_FIREBASE_PROJECT } = await import(
  "../lib/brandGuard.ts"
);

const defaultMessages = await import("../lib/messages.ts");
const defaultEmail = await import("../lib/emailNotice.ts");
const defaultBrand = await import("../lib/brand.ts");
const defaultTools = await import("../lib/mcp/tools.ts");

const previous = process.env.NEXT_PUBLIC_BRAND;
process.env.NEXT_PUBLIC_BRAND = "rda";
const rdaMessages = await import("../lib/messages.ts?brand=rda");
const rdaEmail = await import("../lib/emailNotice.ts?brand=rda");
const rdaBrand = await import("../lib/brand.ts?brand=rda");
const rdaTools = await import("../lib/mcp/tools.ts?brand=rda");
if (previous === undefined) delete process.env.NEXT_PUBLIC_BRAND;
else process.env.NEXT_PUBLIC_BRAND = previous;

describe("brand selection", () => {
  test("unset or unknown reads as Grime Busters", () => {
    assert.equal(asBrandId(undefined), "grime-busters");
    assert.equal(asBrandId(""), "grime-busters");
    assert.equal(asBrandId("RDA"), "grime-busters");
    assert.equal(defaultBrand.BRAND_ID, "grime-busters");
  });

  test("NEXT_PUBLIC_BRAND=rda selects RDA, with mowing as the default service", () => {
    assert.equal(rdaBrand.BRAND_ID, "rda");
    assert.equal(rdaBrand.DEFAULT_SERVICE, "mowing");
    assert.deepEqual(
      [...rdaBrand.OFFERED_SERVICES],
      ["mowing", "landscaping", "aeration", "snow_removal", "window_cleaning"],
    );
  });

  test("Grime Busters keeps exactly the services it had", () => {
    assert.deepEqual(
      [...defaultBrand.OFFERED_SERVICES],
      ["pressure_washing", "landscaping", "snow_removal"],
    );
    assert.equal(defaultBrand.DEFAULT_SERVICE, "pressure_washing");
  });
});

describe("services", () => {
  test("every brand offers only services the data model knows", () => {
    for (const id of BRAND_IDS) {
      for (const service of brandProfile(id).services) {
        assert.ok(SERVICE_TYPES.includes(service), `${id} offers unknown ${service}`);
      }
    }
  });

  test("every service has a label and a short label", () => {
    for (const service of SERVICE_TYPES) {
      assert.ok(SERVICE_LABEL[service], `no label for ${service}`);
      assert.ok(SERVICE_SHORT_LABEL[service], `no short label for ${service}`);
    }
  });

  test("every serviceType check in firestore.rules allows exactly SERVICE_TYPES", () => {
    const rules = read("firestore.rules");
    const lists = [...rules.matchAll(/serviceType in \[([^\]]*)\]/g)].map((match) =>
      match[1].split(",").map((item) => item.trim().replace(/^'|'$/g, "")),
    );
    assert.ok(lists.length >= 4, "expected the job, document, service and quote checks");
    for (const list of lists) {
      assert.deepEqual([...list].sort(), [...SERVICE_TYPES].sort());
    }
  });
});

describe("customer texts carry the right business", () => {
  test("the names in lib/messages.ts agree with lib/brand.ts", () => {
    assert.equal(defaultMessages.CONTACT.name, brandProfile("grime-busters").shortName);
    assert.equal(defaultMessages.CONTACT.legalName, brandProfile("grime-busters").legalName);
    assert.equal(rdaMessages.CONTACT.name, brandProfile("rda").shortName);
    assert.equal(rdaMessages.CONTACT.legalName, brandProfile("rda").legalName);
  });

  test("an RDA text never names Grime Busters, its owner, or its payment handles", () => {
    const texts = [
      rdaMessages.jobFinishedText("Sam"),
      rdaMessages.jobStartedText("Sam"),
      rdaMessages.enRouteText("Marta"),
      rdaMessages.jobConfirmationText("Mowing", new Date(2026, 4, 1, 9)),
    ];
    for (const text of texts) {
      assert.doesNotMatch(text, /Grime|Nicolas|NicolasTimmons|GrimeBustersKYLLC|599-6855/);
      assert.match(text, /RDA Landscape/);
    }
  });

  test("RDA's payment text lists only what RDA takes", () => {
    const text = rdaMessages.jobFinishedText("Sam");
    assert.match(text, /We accept checks made out to RDA Landscape, cash\. /);
    assert.doesNotMatch(text, /Venmo|Cash App/);
    assert.match(text, /Ryland at 502-881-2021/);
  });

  test("Grime Busters' payment text is unchanged", () => {
    assert.match(
      defaultMessages.jobFinishedText("Sam"),
      /We accept checks made out to Grime Busters KY LLC, cash, Venmo @NicolasTimmons, Cash App \$GrimeBustersKYLLC\. If you have none of these please reach out to Nicolas at 502-599-6855\./,
    );
  });

  test("sign-in mail names the brand's own app", () => {
    const rda = rdaEmail.codeEmail({ code: "123456", minutes: 10 });
    assert.match(rda.subject, /RDA Landscape sign-in code/);
    assert.match(rda.text, /RDA Landscape CRM/);
    assert.doesNotMatch(rda.html + rda.text + rda.subject, /Grime/);
    assert.match(defaultEmail.codeEmail({ code: "123456", minutes: 10 }).subject, /Grime Busters/);
  });
});

describe("the agent API describes the brand's own services", () => {
  /** Every serviceType description in the tool list, as one string. */
  const serviceText = (tools) =>
    JSON.stringify(tools.listToolsPayload(["read", "write", "send"]))
      .match(/"serviceType":\{[^}]*\}/g)
      .join(" ");

  for (const [id, tools] of [["grime-busters", defaultTools], ["rda", rdaTools]]) {
    test(`${id}: names every offered service and nothing else`, () => {
      const text = serviceText(tools);
      for (const service of SERVICE_TYPES) {
        const offered = brandProfile(id).services.includes(service);
        assert.equal(text.includes(service), offered, `${service} ${offered ? "missing" : "listed"}`);
      }
      assert.ok(
        JSON.stringify(tools.listToolsPayload(["write"])).includes(brandProfile(id).exampleLineItems[0]),
      );
    });
  }
});

describe("the build guard", () => {
  const rdaFirebase = { NEXT_PUBLIC_BRAND: "rda", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "rda-crm" };

  test("Grime Busters on its own project is fine, set or unset", () => {
    assert.equal(brandDeploymentProblem({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: GRIME_BUSTERS_FIREBASE_PROJECT }), null);
    assert.equal(brandDeploymentProblem({ NEXT_PUBLIC_BRAND: "grime-busters", NEXT_PUBLIC_FIREBASE_PROJECT_ID: GRIME_BUSTERS_FIREBASE_PROJECT }), null);
  });

  test("RDA on its own project is fine", () => {
    assert.equal(brandDeploymentProblem(rdaFirebase), null);
  });

  test("RDA on the Grime Busters project fails", () => {
    const problem = brandDeploymentProblem({
      NEXT_PUBLIC_BRAND: "rda",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: GRIME_BUSTERS_FIREBASE_PROJECT,
    });
    assert.match(problem ?? "", /Grime Busters project/);
  });

  test("a demo build reaches no Firebase project, so it may inherit one", () => {
    assert.equal(
      brandDeploymentProblem({
        NEXT_PUBLIC_BRAND: "rda",
        NEXT_PUBLIC_DEMO_MODE: "true",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: GRIME_BUSTERS_FIREBASE_PROJECT,
      }),
      null,
    );
  });

  test("a misspelt brand fails rather than shipping as Grime Busters", () => {
    assert.match(brandDeploymentProblem({ NEXT_PUBLIC_BRAND: "rda-landscape" }) ?? "", /not a brand/);
  });
});

describe("colours and assets", () => {
  const css = read("app/globals.css");
  const rdaBlock = css.match(/:root\[data-brand="rda"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  const token = (block, name) => block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

  test("the RDA CSS tokens match the colours the PDF and map use", () => {
    const { colors } = brandProfile("rda");
    assert.equal(token(rdaBlock, "canvas"), colors.ink);
    assert.equal(token(rdaBlock, "accent"), colors.accent);
    assert.equal(token(rdaBlock, "accent-ink"), colors.accentInk);
    assert.equal(token(rdaBlock, "money"), colors.money);
    assert.equal(token(rdaBlock, "cream"), colors.cream);
  });

  test("the Grime Busters CSS tokens match its profile", () => {
    const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const { colors } = brandProfile("grime-busters");
    assert.equal(token(theme, "canvas"), colors.ink);
    assert.equal(token(theme, "accent"), colors.accent);
    assert.equal(token(theme, "accent-ink"), colors.accentInk);
    assert.equal(token(theme, "money"), colors.money);
    assert.equal(token(theme, "cream"), colors.cream);
  });

  /** Width and height from a PNG's IHDR chunk. */
  function pngSize(path) {
    const bytes = readFileSync(join(repoRoot, path));
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  for (const id of BRAND_IDS) {
    const { assetBase, logoSize } = brandProfile(id);
    const at = (path) => join("public", assetBase, path);

    test(`${id}: every asset the app links exists`, () => {
      for (const path of [
        "logo.png",
        "logo.jpg",
        "manifest.json",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/apple-touch-icon.png",
        ...["iphone15", "iphone14plus", "iphone13", "iphonex", "iphone8plus", "iphone8"].map(
          (name) => `splash/${name}.png`,
        ),
      ]) {
        assert.ok(existsSync(join(repoRoot, at(path))), `missing ${at(path)}`);
      }
    });

    test(`${id}: logo.png is the size the Logo component reserves`, () => {
      assert.deepEqual(pngSize(at("logo.png")), logoSize);
    });

    test(`${id}: the manifest's icons exist and carry the brand's name`, () => {
      const manifest = JSON.parse(read(at("manifest.json")));
      assert.equal(manifest.name, brandProfile(id).appName);
      for (const icon of manifest.icons) {
        assert.ok(existsSync(join(repoRoot, "public", icon.src)), `missing ${icon.src}`);
      }
    });
  }
});
