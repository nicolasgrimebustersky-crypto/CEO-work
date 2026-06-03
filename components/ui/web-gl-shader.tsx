"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

export function WebGLShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene | null
    camera: THREE.OrthographicCamera | null
    renderer: THREE.WebGLRenderer | null
    mesh: THREE.Mesh | null
    uniforms: any
    animationId: number | null
  }>({
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    uniforms: null,
    animationId: null,
  })

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const { current: refs } = sceneRef

    const vertexShader = `
      attribute vec3 position;
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `

    // Emerald / green-gold streaks tuned to the Grime Bustersky brand palette.
    // Coordinates are normalized to 0..1 across the canvas (uv) then remapped to
    // -1..1 on BOTH axes, so the streak field fills the whole element and looks
    // the same on every aspect ratio / device instead of collapsing on mobile.
    const fragmentShader = `
      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform float xScale;
      uniform float yScale;
      uniform float distortion;

      void main() {
        vec2 uv = gl_FragCoord.xy / resolution;
        vec2 p = uv * 2.0 - 1.0;

        float d = length(p) * distortion;

        float rx = p.x * (1.0 + d);
        float gx = p.x;
        float bx = p.x * (1.0 - d);

        float i1 = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);
        float i2 = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);
        float i3 = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);

        // Map the three streak layers onto an emerald -> mint -> warm-gold ramp
        vec3 deepEmerald = vec3(0.04, 0.45, 0.26);
        vec3 brightMint  = vec3(0.12, 0.90, 0.52);
        vec3 warmGold    = vec3(0.70, 0.85, 0.40);

        vec3 col = i1 * deepEmerald + i2 * brightMint + i3 * warmGold;

        gl_FragColor = vec4(col, 1.0);
      }
    `

    // Size the drawing buffer to the canvas's actual rendered size (not the
    // window) so it stays crisp even when the hero is taller than the viewport.
    const handleResize = () => {
      if (!refs.renderer || !refs.uniforms) return
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      refs.renderer.setPixelRatio(dpr)
      refs.renderer.setSize(width, height, false)
      // gl_FragCoord works in physical drawing-buffer pixels
      refs.uniforms.resolution.value = [width * dpr, height * dpr]
    }

    const initScene = () => {
      refs.scene = new THREE.Scene()
      refs.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      refs.renderer.setClearColor(new THREE.Color(0x050b08))

      refs.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, -1)

      refs.uniforms = {
        resolution: { value: [1, 1] },
        time: { value: 0.0 },
        xScale: { value: 1.0 },
        yScale: { value: 0.5 },
        distortion: { value: 0.05 },
      }

      const position = [
        -1.0, -1.0, 0.0,
         1.0, -1.0, 0.0,
        -1.0,  1.0, 0.0,
         1.0, -1.0, 0.0,
        -1.0,  1.0, 0.0,
         1.0,  1.0, 0.0,
      ]

      const positions = new THREE.BufferAttribute(new Float32Array(position), 3)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", positions)

      const material = new THREE.RawShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: refs.uniforms,
        side: THREE.DoubleSide,
      })

      refs.mesh = new THREE.Mesh(geometry, material)
      refs.scene.add(refs.mesh)

      handleResize()
    }

    const animate = () => {
      if (refs.uniforms) refs.uniforms.time.value += 0.01
      if (refs.renderer && refs.scene && refs.camera) {
        refs.renderer.render(refs.scene, refs.camera)
      }
      refs.animationId = requestAnimationFrame(animate)
    }

    initScene()
    animate()

    window.addEventListener("resize", handleResize)
    // React to container size changes (e.g. mobile address-bar show/hide)
    const observer = new ResizeObserver(handleResize)
    observer.observe(canvas)

    return () => {
      if (refs.animationId) cancelAnimationFrame(refs.animationId)
      window.removeEventListener("resize", handleResize)
      observer.disconnect()
      if (refs.mesh) {
        refs.scene?.remove(refs.mesh)
        refs.mesh.geometry.dispose()
        if (refs.mesh.material instanceof THREE.Material) {
          refs.mesh.material.dispose()
        }
      }
      refs.renderer?.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full block"
    />
  )
}
