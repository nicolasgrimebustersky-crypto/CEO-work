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

        // Wide, soft falloff = a broad satin band of light rather than a sharp neon line
        float i1 = 0.07 / abs(p.y + sin((rx + time) * xScale) * yScale);
        float i2 = 0.07 / abs(p.y + sin((gx + time) * xScale) * yScale);
        float i3 = 0.07 / abs(p.y + sin((bx + time) * xScale) * yScale);

        // Muted, desaturated sage -> soft warm sand ramp (no pure bright green)
        vec3 deepSage = vec3(0.13, 0.27, 0.22);
        vec3 softSage = vec3(0.44, 0.62, 0.52);
        vec3 warmSand = vec3(0.62, 0.62, 0.52);

        vec3 col = i1 * deepSage + i2 * softSage + i3 * warmSand;

        // Reinhard-style roll-off so highlights settle into satin instead of clipping
        col = col / (col + vec3(0.7));
        col *= 0.9;

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
        yScale: { value: 0.42 },
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
