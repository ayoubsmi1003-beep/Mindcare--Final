"use client";

import { useEffect, useRef, useState } from "react";

import { alexa } from "@/i18n/alexa";

/**
 * VagueAlexa — la vague d'écoute (shader `wave` 21st.dev, fond transparent).
 *
 * Affichée pendant `ecoute`/`traitement` à la place de l'orbe. Rend `null`
 * sans WebGL ou en `prefers-reduced-motion` : l'Avatar prend le relais
 * (jamais d'animation décorative). Un seul triangle fullscreen, pas de lib.
 */

const VERTEX_SHADER = `attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;

const WAVE_SHADER = `precision highp float;
uniform vec2 iResolution; uniform float iTime;
const float PI = 3.14159265359;
const float AMPLITUDE   = 0.32;
const float FREQ        = 1.1;
const float ABER_FREQ   = 1.0;
const float SPEED       = 2.4;
const float WAVE_SCALE  = 0.6;
const float ABERRATION  = 2.6;
const float THICKNESS   = 3.0;
const float INTENSITY   = 2.;
const float FALLOFF     = 1.7;
const float EDGE_MASK   = 0.4;
const float EDGE_INSET  = 0.0;
const float BAND_FILL   = 30000.0;
const float BAND_THICK  = 0.08;
const float SOFTNESS    = 2.5;
const float LOW_AMP     = 6.0;
const float LOW_INT     = 1.5;
const float MID_ABER    = 0.8;
const float MID_ABAMP   = 0.05;
const float MID_BAND    = 20.0;
const float MID_SOFT    = 0.4;
const float HIGH_ABER   = 0.5;
const float HIGH_ABAMP  = 0.06;
const float RESOLVED    = 1.0;
const float UNRES_SCALE = 0.14;

vec3 spectral4(int s){
    float x = float(s);
    return clamp(vec3(abs(x-3.0)-1.0, 2.0-abs(x-2.0), 2.0-abs(x-4.0)), 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 R = iResolution.xy;
    float aspect = R.x / R.y;
    vec2 p = (fragCoord + 0.5) * 2.0 / R - 1.0;
    p.x *= aspect;
    float yScreen = p.y;
    p /= max(WAVE_SCALE, 0.1);

    float t   = iTime;
    float low  = clamp(0.45 + 0.45*sin(t*0.8)*sin(t*0.37+1.0), 0.0, 1.0);
    float mid  = clamp(0.40 + 0.40*sin(t*1.7+2.0)*sin(t*0.53), 0.0, 1.0);
    float high = clamp(0.30 + 0.30*sin(t*2.9+4.0)*sin(t*0.71+2.0), 0.0, 1.0);

    float res   = clamp(RESOLVED, 0.0, 1.0);
    float drift = mod(t, 20.0*PI) * SPEED;

    float xN  = p.x / max(aspect, 1.0);
    float env = cos(PI*0.5 * min(abs(0.9*xN), 1.0));
    env *= env;

    float A1    = AMPLITUDE + 0.01*low*LOW_AMP;
    float A2    = A1 + mid*MID_ABAMP + high*HIGH_ABAMP;
    float AB    = (ABERRATION + mid*MID_ABER + high*HIGH_ABER)*res;
    float th    = mix(0.1, 0.01*THICKNESS, res);
    float inten = mix(0.1, 0.01*(INTENSITY + low*LOW_INT), res);
    float soft  = 0.01*res*max(0.0, SOFTNESS + mid*MID_SOFT);

    float dUnres = max(length(p) - mix(0.14, UNRES_SCALE, res), 0.0);
    float yMain = A1 * env * res * sin(p.x*FREQ + drift);

    float bandFillTh = max(BAND_THICK, 1e-4);
    float bandAmt    = 1e-4 * BAND_FILL * inten;
    vec3 num = vec3(0.0), den = vec3(0.0);
    for(int s = 0; s < 4; s++){
        vec3 hue = mix(vec3(1.0), spectral4(s), res);
        den += hue;
        float ab = mix(-AB, AB, float(s)/3.0);
        float yL = A2 * env * res * sin(p.x*ABER_FREQ + drift + ab);
        float d   = mix(dUnres, abs(p.y - yL), res);
        float lor = mix(1.0/(1.0 + (0.02*d)*(0.02*d)), 1.0, res);
        float line = inten / (sqrt(d*d + soft*soft) + th);
        float lo = min(yMain, yL), hi = max(yMain, yL);
        float dBand = max(0.0, max(p.y - hi, lo - p.y));
        float band  = bandAmt / (dBand + bandFillTh);
        num += hue * lor * (line + band);
    }
    vec3 col = num / den;

    float dM    = mix(dUnres, abs(p.y - yMain), res);
    float lorM  = mix(1.0/(1.0 + (0.02*dM)*(0.02*dM)), 1.0, res);
    float boost = (1.0 - res) * (14.0*low + 4.0);
    col += 0.5 * inten * (lorM + boost) / (sqrt(dM*dM + soft*soft) + th);

    col = pow(max(col, 0.0), vec3(1.5));
    float emT = clamp((abs(yScreen) - 1.0 + EDGE_INSET) / (-max(EDGE_MASK, 1e-4)), 0.0, 1.0);
    float em  = emT*emT*(3.0 - 2.0*emT);
    float gauss = exp(-pow(xN*FALLOFF, 2.0));
    col *= mix(1.0, em*gauss, res);
    col *= res;
    fragColor = vec4(col, 1.0);
}
void main(){ mainImage(gl_FragColor, gl_FragCoord.xy); }`;

/** Testable à l'aveugle : le composant lit le navigateur via cette fonction. */
export function vagueDisponible(nav?: {
  readonly webgl: boolean;
  readonly reducedMotion: boolean;
}): boolean {
  if (nav !== undefined) return nav.webgl && !nav.reducedMotion;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const sonde = document.createElement("canvas");
  const gl = sonde.getContext("webgl");
  const reduit =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return gl !== null && !reduit;
}

export interface VagueAlexaProps {
  readonly size?: number;
  readonly className?: string;
}

export function VagueAlexa({ size = 96, className = "" }: VagueAlexaProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prete, setPrete] = useState(false);

  useEffect(() => {
    setPrete(vagueDisponible());
  }, []);

  useEffect(() => {
    if (!prete) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const gl = canvas.getContext("webgl");
    if (gl === null) return;

    const compiler = (type: number, src: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (shader === null) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compiler(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compiler(gl.FRAGMENT_SHADER, WAVE_SHADER);
    if (vs === null || fs === null) return;
    const program = gl.createProgram();
    if (program === null) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uTime = gl.getUniformLocation(program, "iTime");

    const dim = Math.max(32, Math.round(size * 0.75));
    canvas.width = dim;
    canvas.height = dim;
    gl.viewport(0, 0, dim, dim);

    const debut = performance.now();
    let raf = 0;
    const trame = (): void => {
      gl.uniform2f(uResolution, dim, dim);
      gl.uniform1f(uTime, (performance.now() - debut) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(trame);
    };
    trame();

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [prete, size]);

  if (!prete) return null;
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alexa.vagueEcoute}
      className={["block rounded-full", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    />
  );
}

export default VagueAlexa;
