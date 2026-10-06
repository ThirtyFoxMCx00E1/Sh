










#include "star.glsl"


uniform vec4 P4;

vec3 beamLight(float r, float R) {

float k = saturate(r / max(R, 1e-3));
return mix(mix(vec3(1.0, 0.92, 0.94), LASER_HOT, smoothstep(0.02, 0.18, k)), LASER, smoothstep(0.12, 0.6, k));
}

void main() {
initPixel(texCoord);
gTime = P0.y;
gSeed = P0.z;
float R = P0.x;
float fullR = P2.w;
float since = P2.x;
vec3 rd = viewDir(texCoord);
vec3 surf = scenePosAt(texCoord);
bool sky = skyAt(texCoord);
float sceneT = sky ? FAR : length(surf);
vec3 base = sampleScene(texCoord);
vec3 glow = vec3(0.0);
vec2 axis = Target.xz;
float hd = length(surf.xz - axis);


if (P1.x > 0.001) {
float tRay;
float thick = 0.07 + 0.9 * P1.z * P1.z;
float d = raySegmentDist(vec3(0.0), rd, Target, Target + vec3(0.0, 6000.0, 0.0), tRay);
if (tRay < sceneT) {
float w = max(thick, tRay * gPix * 0.7);
float core = saturate(1.2 - d / w) * min(1.0, thick * 2.5 / w + 0.35);
float air = exp(-d / (w * 5.0 + 0.4)) * 0.3 + exp(-d / (w * 30.0 + 4.0)) * 0.05 * (1.0 + 6.0 * P1.z);
float flicker = 0.85 + 0.15 * sin(gTime * 43.0) * sin(gTime * 29.0 + 1.3);
glow += (LASER * (core * 4.0 + air) + LASER_HOT * core * 1.5) * flicker * P1.x;
}
if (!sky) {
float fromDot = length(surf - Target);
float spot = exp(-sqr(fromDot / (0.35 + 1.5 * P1.z)));
float halo = exp(-fromDot / (1.8 + 6.0 * P1.z));
glow += (vec3(1.0, 0.85, 0.85) * spot * 3.0 + LASER * halo * 1.4) * P0.w;
base = mix(base, base * vec3(1.2, 0.3, 0.3), saturate(halo * P0.w));
}
}


if (!sky && abs(surf.y - Target.y) < 40.0 + hd * 0.4) {
float w = max(0.12, sceneT * gPix * 1.2);
float ang = atan(surf.z - axis.y, surf.x - axis.x);
if (P3.x > 0.001 && hd < 12.0) {

float spin = ang + gTime * 0.8;
float br = mix(11.0, 4.5, P3.x);
float bracket = saturate(1.0 - abs(hd - br) / w) * step(0.72, abs(cos(spin * 2.0)));
float ring = saturate(1.0 - abs(hd - 2.6) / w) * step(0.5, fract(ang / TAU * 24.0 + gTime));
float cross = (saturate(1.0 - abs(surf.x - axis.x) / w) + saturate(1.0 - abs(surf.z - axis.y) / w))
* step(1.2, hd) * step(hd, 3.8);
glow += LASER * (bracket * 2.5 + ring * 1.5 + cross * 1.2) * P3.x;
}
if (P1.y > 0.001) {

float edge = saturate(1.1 - abs(hd - fullR) / w);
float sweep = fract((ang / TAU) - gTime * 0.35);
float wedge = exp(-sweep * 14.0) * step(hd, fullR) * smoothstep(0.0, fullR * 0.6, hd);
float ticks = step(0.86, fract(ang / TAU * 72.0)) * step(abs(hd - fullR + 3.0), 2.0);

float pulse = fract(P3.y);
float closing = saturate(1.0 - abs(hd - fullR * (1.0 - pulse)) / (w * 2.0 + 1.0)) * (1.0 - pulse);
glow += LASER * (edge * 2.2 + ticks * 1.2 + wedge * 0.35 + closing * 1.6) * P1.y;
base = mix(base, base * vec3(1.1, 0.75, 0.75), wedge * 0.3 * P1.y);
}
}



if (P1.z > 0.001) {
vec3 up = normalize(Target + vec3(0.0, 4000.0, 0.0));
float toUp = length(rd - up);
glow += LASER * exp(-toUp / 0.35) * P1.z * P1.z * 0.6;

if (sky) {
float dusk = sqr(sqr(P1.z)) * 0.9;
base = mix(base, base * 0.1 + vec3(0.05, 0.0, 0.01), dusk);
}
float drop = 20.0 + 8980.0 * pow(max(1.0 - P1.z, 0.0), 1.5);
vec3 head = Target + vec3(0.0, drop, 0.0);
vec3 hp = project(head);
if (hp.z > 0.0 && length(head) < sceneT) {
vec2 dd = (texCoord - hp.xy) * vec2(OutSize.x / OutSize.y, 1.0);
float px = 1.0 / OutSize.y;
float g = smoothstep(0.2, 1.0, P1.z);
float twinkle = 0.7 + 0.3 * sin(gTime * 53.0) * sin(gTime * 31.0 + 2.0);
float len = (0.03 + 0.3 * g * g) * twinkle;
float core = exp(-dot(dd, dd) / sqr(px * (1.2 + 3.5 * g)));
float cross = exp(-abs(dd.y) / (px * 0.8)) * exp(-abs(dd.x) / len)
+ exp(-abs(dd.x) / (px * 0.8)) * exp(-abs(dd.y) / len);
vec2 r45 = mat2(0.7071, 0.7071, -0.7071, 0.7071) * dd;
float diag = exp(-abs(r45.y) / (px * 0.6)) * exp(-abs(r45.x) / (len * 0.35))
+ exp(-abs(r45.x) / (px * 0.6)) * exp(-abs(r45.y) / (len * 0.35));
float halo = exp(-length(dd) / (px * (6.0 + 40.0 * g)));
glow += (vec3(1.0, 0.92, 0.92) * core * 5.0 + LASER * (cross * 2.4 + diag * 1.1 + halo * 0.7)) * g * 1.6
+ LASER * halo * 0.25 * P1.z;
}
}


if (P1.w > 0.001 && R > 0.05) {

float land = saturate(since / 0.14);
float foot = mix(Target.y + 3000.0, P3.z - 64.0, land * land);
vec2 o = -axis;
vec2 dh = rd.xz;
float hl = length(dh);
float tc = hl > 1e-5 ? -dot(o, dh) / (hl * hl) : 0.0;
float b = length(o + dh * tc);
vec2 hit = rayCylinderY(vec3(0.0), rd, vec3(Target.x, 0.0, Target.z), R);
bool solid = false;
if (hit.y > 0.0) {
float t0 = max(hit.x, 0.0);
float t1 = min(hit.y, sceneT);

if (rd.y < -1e-4) {
float tf = foot / rd.y;
t1 = tf > 0.0 ? min(t1, tf) : -1.0;
} else if (rd.y > 1e-4) {
t0 = max(t0, foot / rd.y);
} else if (foot > 0.0) {
t1 = -1.0;
}
if (t1 > t0) {
solid = true;
float x = saturate(b / R);


float wc = 0.07;
float sc = (t0 - tc) * hl / R;
float ec = (t1 - tc) * hl / R;
float run = smoothstep(-1.4 * wc, 1.4 * wc, ec) - smoothstep(-1.4 * wc, 1.4 * wc, sc);
float heart = exp(-sqr(x / wc)) * run;

vec3 enter = rd * t0;
float a0 = atan(enter.z - axis.y, enter.x - axis.x + 1e-6);
float fall = gTime * 260.0;
float streak = fbm2(vec2(a0 * R * 0.05 + enter.y * 0.01, (enter.y + fall) * 0.016));
float bands = 0.5 + 0.5 * sin((enter.y + fall * 1.5) * 0.04 + a0 * 3.0);
float energy = 0.7 + 0.45 * streak * (0.6 + 0.4 * bands);
vec3 deep = vec3(0.62, 0.0, 0.02);
vec3 red = vec3(0.96, 0.02, 0.05);
vec3 hot = vec3(0.98, 0.3, 0.3);
vec3 c = mix(red, deep, smoothstep(0.45, 1.0, x));
c = mix(c, hot, smoothstep(0.3, 0.0, x) * 0.75);
c *= energy;
float skin = exp(-(1.0 - x) * R / (R * 0.01 + 0.25));
c = mix(c, vec3(1.0, 0.12, 0.14), skin * 0.8);
c = mix(c, vec3(1.0, 0.92, 0.92), saturate(heart * 1.3));
float flick = 0.94 + 0.06 * sin(gTime * 60.0) * sin(gTime * 37.0);
base = mix(base, c * flick, P1.w);
glow *= 1.0 - P1.w;
}
}

if (!solid) {
float shade = P1.w * land * (1.0 - P2.y);
base = mix(base, base * vec3(0.55, 0.12, 0.14), shade * 0.8);
}

if (!solid && tc > 0.0 && tc < sceneT) {
float out_ = max(b - R, 0.0);
float haze = exp(-out_ / (R * 0.16)) * 0.4 + exp(-out_ / (R * 1.2)) * 0.12;
glow += vec3(1.0, 0.02, 0.05) * haze * P1.w * land;
}


if (!sky && hd > R) {
float wall = hd - R;
float lit = R * 1.6 / (wall + R * 0.25) * exp(-wall / (R * 2.5));
base = mix(base, base * vec3(1.9, 0.35, 0.35), saturate(lit * 0.5) * P1.w);
glow += vec3(1.0, 0.05, 0.08) * exp(-wall / 6.0) * 1.2 * P1.w * land;
}

if (!sky && since > 0.0 && since < 3.0) {
float front = R + since * 160.0;
float ring = exp(-abs(hd - front) / (4.0 + since * 5.0)) * (1.0 - since / 3.0);
glow += mix(LASER_HOT, LASER, since / 3.0) * ring * 2.5 * step(abs(surf.y - Target.y), 40.0 + since * 30.0);
}
}


if (sky && P4.x > 0.001) {
vec2 sh = rayCylinderY(vec3(0.0), rd, vec3(Target.x, 0.0, Target.z), fullR - 0.5);
if (sh.y > 0.0 && rd.y < -0.02) {

float tIn = max(sh.x, 0.0);
float yIn = rd.y * tIn;
float tRim = P3.w / rd.y;
float tDown = max(tIn, tRim);
if (tDown < sh.y || yIn < P3.w) {
vec3 at = rd * tDown;
float fromWall = fullR - length(at.xz - axis);
float deep = saturate((P3.w - rd.y * sh.y) / 300.0);
vec3 abyss = mix(vec3(0.05, 0.005, 0.008), vec3(0.0), deep);
abyss += vec3(0.5, 0.05, 0.02) * exp(-max(fromWall, 0.0) / 30.0) * (0.3 + 0.7 * P2.z);
base = mix(base, abyss, P4.x);
}
}
}


if (!sky && P2.z > 0.001) {
float inWall = fullR - hd;
if (inWall > -1.5 && inWall < 6.0 && surf.y < P3.w + 2.0) {
float heat = P2.z * exp(-max(inWall, 0.0) / 2.5) * smoothstep(-1.5, 0.3, inWall);
float cracks = fbm2(vec2(atan(surf.z - axis.y, surf.x - axis.x) * fullR * 0.35, surf.y * 0.35));
float depthCool = smoothstep(P3.w + 2.0, P3.w - 120.0, surf.y) * 0.4 + 0.6;
float t = heat * (0.55 + 0.45 * cracks) * depthCool;
glow += blackbody(0.15 + 0.55 * t) * t * 2.6;
base = mix(base, base * vec3(0.35, 0.2, 0.18), saturate(heat));
}

float lip = exp(-abs(hd - fullR) / 0.8) * smoothstep(P3.w - 6.0, P3.w + 1.0, surf.y);
glow += blackbody(0.35 + 0.4 * P2.z) * lip * P2.z * 2.0;
}


fragColor = vec4(tonemap(base + glow), 1.0);
}
