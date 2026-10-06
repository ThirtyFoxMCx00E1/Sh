#version 330





layout(std140) uniform DynamicTransforms {
mat4 ModelViewMat;
vec4 ColorModulator;
vec3 ModelOffset;
mat4 TextureMat;
};

in vec2 texCoord0;
in vec4 vertexColor;

out vec4 fragColor;

const float TAU = 6.2831853;

float hash(vec2 p) {
p = fract(p * vec2(0.1031, 0.1030));
p += dot(p, p.yx + 33.33);
return fract((p.x + p.y) * p.x);
}

void main() {
vec2 uv = texCoord0;
float step20 = floor((uv.x + 2.0) / 4.0);
uv.x -= step20 * 4.0;
float progress = step20 / 20.0;
float sweep = vertexColor.r * TAU;
float lock = vertexColor.g;
float beat = vertexColor.b;
float white = vertexColor.a;


vec2 cells = vec2(34.0, 36.0);
vec2 cell = (uv * 0.5 + 0.5) * cells;
vec2 q = (floor(cell) + 0.5) / cells * 2.0 - 1.0;
vec2 f = fract(cell);
float gap = step(0.14, f.x) * step(0.14, f.y);
float r = length(q);
float ang = atan(q.y, q.x);
float c = 0.0;
float hot = 0.0;


c += step(abs(r - 0.42), 0.03) * 0.35 + step(abs(r - 0.82), 0.03) * 0.4;
c += (step(abs(q.x), 0.03) + step(abs(q.y), 0.03)) * step(r, 0.82) * 0.16;
float idle = 1.0 - lock;

float behind = mod(sweep - ang, TAU);
c += exp(-behind * 2.4) * step(r, 0.82) * idle * 0.95;
for (int i = 0; i < 5; i++) {
vec2 b = vec2(hash(vec2(float(i), 1.7)), hash(vec2(float(i), 5.3))) * 1.3 - 0.65;
float passed = mod(sweep - atan(b.y, b.x), TAU);
c += step(length(q - b), 0.07) * exp(-passed * 1.2) * idle;
}

if (lock > 0.001) {
float br = mix(0.8, 0.3, lock);
vec2 a = abs(q);
float box = step(abs(max(a.x, a.y) - br), 0.035) * step(br * 0.5, min(a.x, a.y));
c += box * lock;
hot += step(r, 0.07 + 0.06 * (1.0 - beat)) * lock;
c += step(abs(r - beat * 0.82), 0.035) * (1.0 - beat) * lock * 0.9;

float bar = step(-0.95, q.y) * step(q.y, -0.86) * step(abs(q.x), 0.9);
c += bar * (step(q.x, -0.9 + 1.8 * progress) * 0.9 + 0.12) * lock;
float head = step(0.86, q.y) * step(q.y, 0.95) * step(abs(q.x), 0.62) * step(0.35, fract(q.x * 4.3 + 0.5));
c += head * step(0.5, fract(beat + 0.25)) * lock;
} else {

float head = step(0.86, q.y) * step(q.y, 0.95) * step(abs(q.x), 0.8);
c += head * step(0.6, hash(vec2(floor(q.x * 8.0 + sweep * 3.0), 3.0))) * 0.5;
}

vec3 red = vec3(1.0, 0.1, 0.13);
vec3 col = vec3(0.05, 0.004, 0.01);
col = mix(col, red, clamp(c, 0.0, 1.0));
col = mix(col, vec3(1.0, 0.82, 0.84), clamp(hot, 0.0, 1.0));
col *= mix(0.55, 1.0, gap);

col *= 0.92 + 0.08 * sin(uv.y * 90.0);
col *= 1.0 - 0.25 * dot(uv, uv) * 0.5;
col = mix(col, vec3(1.0, 0.86, 0.88), clamp(white, 0.0, 1.0));
fragColor = vec4(col, 1.0) * ColorModulator;
}
