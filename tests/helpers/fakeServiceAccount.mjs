/**
 * A service-account credential that is well-formed and worth nothing.
 *
 * lib/server/admin.ts reads FIREBASE_SERVICE_ACCOUNT_KEY once, at module load,
 * and refuses to start without a parseable one — so a test that wants to run
 * the real server code has to supply something. Against the Firestore emulator
 * the Admin SDK parses this and then never signs or verifies anything with it,
 * which is the same bargain scripts/test-api.sh already makes.
 *
 * The key is generated fresh in memory on every run. Nothing is written to
 * disk and there is no fixture to be mistaken one day for a real credential.
 */
import { generateKeyPairSync } from "node:crypto";

export function fakeServiceAccountB64(projectId) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return Buffer.from(
    JSON.stringify({
      type: "service_account",
      project_id: projectId,
      private_key_id: "test",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      client_email: `test@${projectId}.iam.gserviceaccount.com`,
      client_id: "1",
    }),
  ).toString("base64");
}
