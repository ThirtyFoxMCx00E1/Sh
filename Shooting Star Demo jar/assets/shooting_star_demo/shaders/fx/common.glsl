#version 150




uniform sampler2D DiffuseSampler;
uniform sampler2D DepthSampler;
uniform sampler2D AuxSampler;
uniform mat4 InvProj;
uniform mat4 InvView;
uniform mat4 ViewProj;
uniform vec2 OutSize;
uniform float GTime;

uniform float Time;
uniform vec3 Origin;
uniform vec3 Target;
uniform vec3 Caster;
uniform vec3 Facing;
uniform vec4 P0;
uniform vec4 P1;
uniform vec4 P2;
uniform vec4 P3;
uniform vec4 Pts[16];

in vec2 texCoord;
out vec4 fragColor;

#define PI 3.14159265
#define TAU 6.28318531
#define FAR 100000.0


vec3 unproject(vec2 uv, float depth) {
vec4 v = InvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
v.xyz /= v.w;
return (InvView * vec4(v.xyz, 1.0)).xyz;
}

vec3 viewDir(vec2 uv) {
return normalize(unproject(uv, 1.0) - unproject(uv, 0.0));
}

float rawDepth(vec2 uv) {
return texture(DepthSampler, uv).r;
}

bool skyAt(vec2 uv) {
return rawDepth(uv) >= 0.99999;
}


vec3 scenePosAt(vec2 uv) {
float d = rawDepth(uv);
if (d >= 0.99999) {
return viewDir(uv) * FAR;
}
return unproject(uv, d);
}


vec3 project(vec3 p) {
vec4 c = ViewProj * vec4(p, 1.0);
if (c.w <= 0.0) {
return vec3(0.0, 0.0, -1.0);
}
return vec3(c.xy / c.w * 0.5 + 0.5, c.w);
}

vec3 sampleScene(vec2 uv) {
return texture(DiffuseSampler, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}


mat2 rot(float a) {
float c = cos(a), s = sin(a);
return mat2(c, -s, s, c);
}

float saturate(float x) { return clamp(x, 0.0, 1.0); }



float sqr(float x) { return x * x; }

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash11(float p) {
p = fract(p * 0.1031);
p *= p + 33.33;
p *= p + p;
return fract(p);
}

float hash12(vec2 p) {
vec3 p3 = fract(vec3(p.xyx) * 0.1031);
p3 += dot(p3, p3.yzx + 33.33);
return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
p3 += dot(p3, p3.yzx + 33.33);
return fract((p3.xx + p3.yz) * p3.zy);
}

float hash13(vec3 p3) {
p3 = fract(p3 * 0.1031);
p3 += dot(p3, p3.zyx + 31.32);
return fract((p3.x + p3.y) * p3.z);
}

float vnoise2(vec2 p) {
vec2 i = floor(p);
vec2 f = fract(p);
vec2 u = f * f * (3.0 - 2.0 * f);
return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float vnoise3(vec3 p) {
vec3 i = floor(p);
vec3 f = fract(p);
vec3 u = f * f * (3.0 - 2.0 * f);
float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
return mix(a, b, u.z);
}

float fbm2(vec2 p) {
float v = 0.0, a = 0.5;
for (int i = 0; i < 5; i++) {
v += a * vnoise2(p);
p = p * 2.03 + vec2(17.1, 9.2);
a *= 0.5;
}
return v;
}

float fbm3(vec3 p) {
float v = 0.0, a = 0.5;
for (int i = 0; i < 4; i++) {
v += a * vnoise3(p);
p = p * 2.02 + vec3(11.3, 5.7, 3.1);
a *= 0.5;
}
return v;
}

float smin(float a, float b, float k) {
float h = saturate(0.5 + 0.5 * (b - a) / k);
return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSegment2(vec2 p, vec2 a, vec2 b) {
vec2 pa = p - a, ba = b - a;
float h = saturate(dot(pa, ba) / dot(ba, ba));
return length(pa - ba * h);
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
vec3 pa = p - a, ba = b - a;
float h = saturate(dot(pa, ba) / dot(ba, ba));
return length(pa - ba * h) - r;
}

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
vec3 pa = p - a, ba = b - a;
float h = saturate(dot(pa, ba) / dot(ba, ba));
return length(pa - ba * h) - mix(r1, r2, h);
}


float rayPointDist(vec3 ro, vec3 rd, vec3 p, out float t) {
t = max(dot(p - ro, rd), 0.0);
return length(ro + rd * t - p);
}


float raySegmentDist(vec3 ro, vec3 rd, vec3 a, vec3 b, out float tRay) {
vec3 ba = b - a;
vec3 oa = ro - a;
float baba = dot(ba, ba);
float bard = dot(ba, rd);
float baoa = dot(ba, oa);
float rdoa = dot(rd, oa);
float denom = baba - bard * bard;
float s = denom > 1e-6 ? saturate((baoa - bard * rdoa) / denom) : 0.0;
vec3 q = a + ba * s;
tRay = max(dot(q - ro, rd), 0.0);
return length(ro + rd * tRay - q);
}

vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
vec3 oc = ro - c;
float b = dot(oc, rd);
float h = b * b - dot(oc, oc) + r * r;
if (h < 0.0) return vec2(-1.0);
h = sqrt(h);
return vec2(-b - h, -b + h);
}


vec2 rayCylinderY(vec3 ro, vec3 rd, vec3 c, float r) {
vec2 o = ro.xz - c.xz;
vec2 d = rd.xz;
float a = dot(d, d);
if (a < 1e-8) return vec2(-1.0);
float b = dot(o, d);
float cc = dot(o, o) - r * r;
float h = b * b - a * cc;
if (h < 0.0) return vec2(-1.0);
h = sqrt(h);
return vec2((-b - h) / a, (-b + h) / a);
}

float rayPlane(vec3 ro, vec3 rd, vec3 c, vec3 n) {
float d = dot(rd, n);
if (abs(d) < 1e-6) return -1.0;
return dot(c - ro, n) / d;
}



float gAA = 0.002;
float gPix = 0.001;


void initPixel(vec2 uv) {
gPix = length(viewDir(uv + vec2(0.0, 1.0 / OutSize.y)) - viewDir(uv));
}


float line(float d, float w) {
float aa = max(gAA, 1e-4);
return smoothstep(w + aa, w - aa, d);
}


float halo(float d, float w) {
return w * w / (d * d + w * w);
}



float glyph(vec2 uv, float id) {
if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1e3;
float d = 1e3;
for (int i = 0; i < 16; i++) {
float bit = hash11(id * 17.0 + float(i) * 3.1);
if (bit < 0.62) continue;
vec2 a, b;
int k = i;
if (k < 6) {
float row = float(k / 2);
float col = float(k - (k / 2) * 2);
a = vec2(col * 0.5, row * 0.5); b = a + vec2(0.5, 0.0);
} else if (k < 12) {
k -= 6;
float col = float(k / 2);
float row = float(k - (k / 2) * 2);
a = vec2(col * 0.5, row * 0.5); b = a + vec2(0.0, 0.5);
} else {
k -= 12;
a = vec2(float(k - (k / 2) * 2) * 0.5, float(k / 2) * 0.5);
b = a + vec2(0.5, 0.5);
if (hash11(id + float(k)) > 0.5) { a.x += 0.5; b.x -= 0.5; }
}
d = min(d, sdSegment2(uv, a * 0.8 + 0.1, b * 0.8 + 0.1));
}
return d;
}


float runeBand(vec2 p, float r0, float r1, float count, float rotation, float seed) {
float r = length(p);
if (r < r0 || r > r1) return 0.0;
float a = atan(p.y, p.x) + rotation;
float cell = a / TAU * count;
float id = floor(cell);
vec2 uv = vec2(fract(cell), (r - r0) / (r1 - r0));
uv.x = (uv.x - 0.5) * (TAU * r / count) / (r1 - r0) + 0.5;
float d = glyph(uv, mod(id, count) + seed * 97.0);
float w = 0.04;
return line(d, w);
}

float ringLine(float r, float radius, float w) {
return line(abs(r - radius), w);
}


float heptagram(vec2 p, float radius, float rotation, float w) {
float d = 1e3;
for (int i = 0; i < 7; i++) {
float a0 = float(i) * TAU / 7.0 + rotation;
float a1 = float(i + 3) * TAU / 7.0 + rotation;
d = min(d, sdSegment2(p, radius * vec2(cos(a0), sin(a0)), radius * vec2(cos(a1), sin(a1))));
}
return line(d, w);
}





vec2 magicCircle(vec2 p, float R, float t, float seed, float detail) {
p /= R;
float r = length(p);
if (r > 1.12) return vec2(0.0, 0.25 * halo(r - 1.0, 0.08));
float spin = t * 0.25;
float v = 0.0;
v += ringLine(r, 1.0, 0.008);
v += ringLine(r, 0.965, 0.003);
v += runeBand(p, 0.84, 0.95, 44.0, spin, seed);
v += ringLine(r, 0.83, 0.006);
v += ringLine(r, 0.80, 0.003);

float a = atan(p.y, p.x) - spin * 0.5;
float tick = abs(fract(a / TAU * 84.0) - 0.5);
v += line(tick * TAU * r / 84.0, 0.003) * step(0.72, r) * step(r, 0.79);
v += heptagram(p, 0.70, -spin * 0.6 + seed, 0.005);
v += ringLine(r, 0.70, 0.004);
for (int i = 0; i < 7; i++) {
float ai = float(i) * TAU / 7.0 - spin * 0.6 + seed;
vec2 c = 0.70 * vec2(cos(ai), sin(ai));
float rc = length(p - c);
v += ringLine(rc, 0.075, 0.004) + ringLine(rc, 0.045, 0.003) + line(rc, 0.012);
}
if (detail > 0.5) {
v += runeBand(p, 0.30, 0.40, 18.0, -spin * 1.7, seed + 3.0);
v += ringLine(r, 0.41, 0.004);
v += ringLine(r, 0.29, 0.004);
v += heptagram(p, 0.22, spin * 2.0, 0.004);
v += ringLine(r, 0.12, 0.005);
}
float glow = 0.35 * halo(r - 1.0, 0.04) + 0.12 * halo(r - 0.7, 0.03) + 0.12 * (1.0 - smoothstep(0.0, 1.0, r))
+ 0.18 * smoothstep(0.83, 0.9, r) * smoothstep(0.96, 0.9, r);
return vec2(saturate(v) * 0.85, glow);
}



vec2 circleOnTerrain(vec3 surface, vec3 rd, vec3 center, float R, float t, float seed, float detail) {
vec3 q = surface - center;
if (abs(q.y) > R * 0.6 + 3.0 || length(q.xz) > R * 1.6) return vec2(0.0);
float dist = length(surface);
gAA = gPix * dist / (R * max(abs(rd.y), 0.12)) * 0.7;
float fade = 1.0 - smoothstep(R * 0.3 + 1.0, R * 0.6 + 3.0, abs(q.y));
return magicCircle(q.xz, R, t, seed, detail) * fade;
}

vec2 runeRing(vec2 p, float R, float t, float seed) {
p /= R;
float r = length(p);
if (r > 1.1 || r < 0.75) return vec2(0.0, 0.2 * halo(r - 0.9, 0.06));
float v = ringLine(r, 1.0, 0.01) + ringLine(r, 0.82, 0.008) + runeBand(p, 0.84, 0.98, 36.0, t * 0.4, seed);
return vec2(saturate(v), 0.3 * halo(r - 0.91, 0.08));
}


vec2 circleOnPlane(vec3 ro, vec3 rd, vec3 center, vec3 n, vec3 tangent, float R, float t, float seed,
float sceneT, float detail, out float hitT) {
hitT = rayPlane(ro, rd, center, n);
if (hitT <= 0.0 || hitT > sceneT) { hitT = -1.0; return vec2(0.0); }
vec3 q = ro + rd * hitT - center;
vec3 bt = cross(n, tangent);
vec2 p = vec2(dot(q, tangent), dot(q, bt));
if (length(p) > R * 1.6) return vec2(0.0);
float cosine = abs(dot(rd, n));
gAA = gPix * hitT / (R * max(cosine, 0.08)) * 0.7;

float facing = smoothstep(0.02, 0.2, cosine);
return magicCircle(p, R, t, seed, detail) * facing;
}






vec3 dimWorld(vec3 base, float dim, vec3 tint) {
return mix(base, base * tint, saturate(dim));
}


float lightFalloff(float d, float radius) {
return radius * radius / (d * d + radius * radius);
}


float shockRings(float dist, float t, float speed, float spacing) {
return 0.05 / max(abs(fract(dist / spacing - t * speed) - 0.5), 0.025);
}

vec3 tonemap(vec3 c) {


vec3 hot = max(c - 1.0, 0.0);
c += dot(hot, vec3(0.3333)) * 0.5;
vec3 over = max(c - 0.8, 0.0);
return min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
}



vec3 prismStop(int i) {
return i == 0 ? vec3(1.0, 0.07, 0.1) : i == 1 ? vec3(1.0, 0.42, 0.03) : i == 2 ? vec3(1.0, 0.88, 0.06)
: i == 3 ? vec3(0.1, 0.95, 0.28) : i == 4 ? vec3(0.06, 0.48, 1.0) : i == 5 ? vec3(0.28, 0.14, 1.0)
: vec3(0.74, 0.16, 1.0);
}


vec3 prism7(float h) {
float x = fract(h) * 7.0;
int i = int(floor(x));
float f = x - float(i);
f = f * f * (3.0 - 2.0 * f);
return mix(prismStop(i), prismStop(i == 6 ? 0 : i + 1), f);
}
