















#include "star.glsl"

const vec3 VIOLET = vec3(0.62, 0.48, 1.0);
const vec3 VIOLET_HOT = vec3(0.86, 0.8, 1.0);
const vec3 WHITE_HOT = vec3(0.97, 0.95, 1.0);


int linkA(int k) { return k == 0 ? 0 : k == 1 ? 1 : k == 2 ? 2 : k == 3 ? 3 : k == 4 ? 3 : k == 5 ? 4 : 5; }
int linkB(int k) { return k == 0 ? 1 : k == 1 ? 2 : k == 2 ? 3 : k == 3 ? 0 : k == 4 ? 4 : k == 5 ? 5 : 6; }

float hexLine(vec2 p, float r) {
const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
p = abs(p);
p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
return abs(length(p) * sign(p.y));
}

float digitDist(vec2 p, int n) {
int m = n == 0 ? 63 : n == 1 ? 6 : n == 2 ? 91 : n == 3 ? 79 : n == 4 ? 102 : n == 5 ? 109 : n == 6 ? 125
: n == 7 ? 7 : n == 8 ? 127 : 111;
float d = 1e3;
if ((m & 1) != 0) d = min(d, sdSegment2(p, vec2(0.15, 1.85), vec2(0.85, 1.85)));
if ((m & 2) != 0) d = min(d, sdSegment2(p, vec2(0.9, 1.78), vec2(0.9, 1.07)));
if ((m & 4) != 0) d = min(d, sdSegment2(p, vec2(0.9, 0.93), vec2(0.9, 0.22)));
if ((m & 8) != 0) d = min(d, sdSegment2(p, vec2(0.15, 0.15), vec2(0.85, 0.15)));
if ((m & 16) != 0) d = min(d, sdSegment2(p, vec2(0.1, 0.93), vec2(0.1, 0.22)));
if ((m & 32) != 0) d = min(d, sdSegment2(p, vec2(0.1, 1.78), vec2(0.1, 1.07)));
if ((m & 64) != 0) d = min(d, sdSegment2(p, vec2(0.15, 1.0), vec2(0.85, 1.0)));
return d;
}

float readout(vec2 uv, vec2 at, float h, float value, int count, float aa) {
vec2 p = (uv - at) / (h * 0.5);
float cellW = 1.35;
if (p.y < -0.2 || p.y > 2.2 || p.x < -0.2 || p.x > cellW * float(count)) return 0.0;
float i = floor(p.x / cellW);
int digit = int(mod(floor(value / pow(10.0, float(count) - 1.0 - i) + 0.001), 10.0));
return smoothstep(0.1 + aa, 0.1 - aa, digitDist(vec2(p.x - i * cellW, p.y), digit));
}


float starLy(int i) {
return i == 0 ? 123.0 : i == 1 ? 79.0 : i == 2 ? 83.0 : i == 3 ? 81.0 : i == 4 ? 83.0 : i == 5 ? 83.0 : 104.0;
}


vec3 glint(vec3 at, float size, float sceneT, vec3 tint) {
vec3 hp = project(at);
if (hp.z <= 0.0 || length(at) > sceneT + 5.0) return vec3(0.0);
vec2 dd = (texCoord - hp.xy) * vec2(OutSize.x / OutSize.y, 1.0);
float px = 1.0 / OutSize.y;
float twinkle = 0.8 + 0.2 * sin(gTime * 47.0 + size * 13.0);
float len = (0.02 + 0.22 * size) * twinkle;
float core = exp(-dot(dd, dd) / sqr(px * (1.5 + 4.0 * size)));
float cross = exp(-abs(dd.y) / (px * 0.8)) * exp(-abs(dd.x) / len) + exp(-abs(dd.x) / (px * 0.8)) * exp(-abs(dd.y) / len);
vec2 r45 = mat2(0.7071, 0.7071, -0.7071, 0.7071) * dd;
float diag = exp(-abs(r45.y) / (px * 0.6)) * exp(-abs(r45.x) / (len * 0.3)) + exp(-abs(r45.x) / (px * 0.6)) * exp(-abs(r45.y) / (len * 0.3));
float halo = exp(-length(dd) / (px * (6.0 + 40.0 * size)));
return WHITE_HOT * core * 5.0 + tint * (cross * 2.2 + diag * 0.9 + halo * 0.7);
}

void main() {
initPixel(texCoord);
gTime = P0.x;
gSeed = P0.y;
vec3 rd = viewDir(texCoord);
vec3 surf = scenePosAt(texCoord);
bool sky = skyAt(texCoord);
float sceneT = sky ? FAR : length(surf);
vec3 base = sampleScene(texCoord);
vec3 glow = vec3(0.0);
float skyH = P1.z;
float linkS = P1.x;
float finale = P1.y;
float K = P2.w;
float aaB = gPix * sceneT / max(abs(rd.y), 0.08);
gAA = aaB;


if (sky && P0.w > 0.001) {
float zen = smoothstep(0.05, 0.75, rd.y);
float night = P0.w * zen;
base = mix(base, base * 0.06 + vec3(0.012, 0.01, 0.03), night * 0.94);
glow += starField(rd, gPix, 0.9) * night;
}


for (int i = 0; i < 7; i++) {
vec3 node = Pts[i].xyz;
float since = Pts[i].w;
float R = Pts[7 + i].x;
float fall = Pts[7 + i].z;
float lock = Pts[7 + i].w;
vec3 skyPos = node + vec3(0.0, skyH, 0.0);

if (fall < 0.001 && since < 0.0 && lock > 0.001) {
glow += glint(skyPos, 0.08 + 0.12 * lock, sceneT, VIOLET) * lock * 0.8;
}

if (fall > 0.001 && since < 0.0) {
float h = 12.0 * K + (skyH - 12.0 * K) * pow(max(1.0 - fall, 0.0), 0.75);
vec3 head = node + vec3(0.0, h, 0.0);
float tRay;
float d = raySegmentDist(vec3(0.0), rd, head, skyPos, tRay);
if (tRay < sceneT) {
vec3 at = rd * tRay;
float up = saturate((at.y - head.y) / max(skyH - h, 1.0));
float w = max(0.4 * K + h * 0.003, tRay * gPix * 0.8);
glow += (mix(WHITE_HOT, VIOLET, saturate(up * 3.0)) * exp(-d / w) * 2.2 + VIOLET * exp(-d / (w * 8.0 + 2.0)) * 0.4)
* exp(-up * 1.5);
}
for (int r = 0; r < 3; r++) {
float dy = h * (0.02 + float(r) * 0.035) + float(r) * 2.0 * K;
float tp = (head.y + dy) / rd.y;
if (abs(rd.y) < 1e-4 || tp <= 0.0 || tp > sceneT) continue;
vec3 q = rd * tp;
float rr = length(q.xz - node.xz);
glow += vec3(0.9, 0.9, 1.0) * exp(-sqr((rr - dy * 0.32) / max(0.3 * K + dy * 0.02, tp * gPix))) * (0.8 - float(r) * 0.2)
* smoothstep(0.3, 0.8, fall);
}
glow += glint(head, 0.3 + 0.7 * fall, sceneT, VIOLET_HOT) * (0.5 + fall);

if (!sky) {
float hd = length(surf.xz - node.xz);
base += base * VIOLET_HOT * fall * fall * 1.6 * exp(-hd / (R * 2.5));
}
}

if (since >= 0.0) {
float tc;
float dc = rayPointDist(vec3(0.0), rd, node + vec3(0.0, 3.0 * K, 0.0), tc);
glow += WHITE_HOT * exp(-dc / ((4.0 + since * 50.0) * K)) * exp(-since * 8.0) * 6.0 * step(tc, sceneT + 20.0 * K);
float tCol;
float dCol = raySegmentDist(vec3(0.0), rd, node, node + vec3(0.0, skyH, 0.0), tCol);
float wc = max(R * 0.25, tCol * gPix);
glow += (WHITE_HOT * exp(-dCol / wc) * 2.5 + VIOLET * exp(-dCol / (wc * 5.0)) * 0.5) * exp(-since * 3.5)
* step(tCol, sceneT + 10.0 * K);
if (!sky && abs(surf.y - node.y) < R + 30.0 * K) {
vec2 q = surf.xz - node.xz;
float hd = length(q);
float front = R * 0.9 + since * 150.0 * K;
float ring = exp(-sqr((hd - front) / ((2.0 + since * 6.0) * K))) * exp(-since * 1.2);
glow += mix(WHITE_HOT, VIOLET, saturate(since)) * ring * 2.6;
if (hd < R * 1.05) {
float cracks = fbm2(surf.xz * 0.3 / K + float(i) * 5.0);
float heat = exp(-since / 20.0) * exp(-hd / (R * 0.45)) * (0.4 + 0.9 * smoothstep(0.45, 0.7, cracks));
glow += mix(VIOLET, WHITE_HOT, saturate(heat * 1.2)) * heat * 2.4 + blackbody(0.3) * heat * heat * 0.3;
}

float draw = smoothstep(0.0, 0.25, since);
float cool = exp(-since / 14.0);
float hexA = line(hexLine(rot(since * 0.25 + float(i)) * q, R * 1.25), 0.4 * K)
* step(0.35, abs(fract(atan(q.y, q.x) / TAU * 6.0 + since * 0.04) - 0.5) * 2.0);
float ringsT = line(abs(hd - R * 1.45), 0.3 * K) * step(0.4, fract(atan(q.y, q.x) / TAU * 60.0))
+ line(abs(hd - R * 1.55), 0.18 * K);
vec2 lab = q - vec2(R * 1.7, -R * 0.2);
float digits = readout(lab, vec2(0.0), 6.0 * K, starLy(i), 3, aaB / (3.0 * K))
+ readout(q - vec2(-R * 1.7 - 6.0 * K, -R * 0.2), vec2(0.0), 6.0 * K, float(i + 1), 1, aaB / (3.0 * K));
glow += mix(VIOLET * 0.6, VIOLET_HOT, cool) * (hexA + ringsT + digits * 1.4) * draw * (0.3 + 1.4 * cool);
}
}
}


if (P0.z > 0.001 && !sky) {
for (int i = 0; i < 7; i++) {
vec3 node = Pts[i].xyz;
if (Pts[i].w >= 0.0 || abs(surf.y - node.y) > 40.0 * K) continue;
vec2 q = surf.xz - node.xz;
float R = Pts[7 + i].x;
float spin = gTime * 0.5 + float(i);
float hr = mix(R * 1.8, R * 0.9, P2.x);
float hex = line(hexLine(rot(spin) * q, hr), 0.4 * K) * step(0.3, abs(fract(atan(q.y, q.x) / TAU * 6.0) - 0.5) * 2.0);
float inner = line(abs(length(q) - 3.0 * K), 0.25 * K) + step(length(q), K);
float idx = readout(q - vec2(hr + 4.0 * K, -3.0 * K), vec2(0.0), 6.0 * K, float(i + 1), 1, aaB / (3.0 * K));
glow += VIOLET * (hex * 2.0 + inner * 1.6 + idx * 2.0) * P0.z;
}
for (int k = 0; k < 7; k++) {
vec3 a = Pts[linkA(k)].xyz;
vec3 b = Pts[linkB(k)].xyz;
float d = sdSegment2(surf.xz, a.xz, b.xz);
vec2 ab = b.xz - a.xz;
float u = dot(surf.xz - a.xz, ab) / dot(ab, ab);
float dash = step(0.45, fract(u * length(ab) / (10.0 * K) - gTime * 1.5));
float y = mix(a.y, b.y, saturate(u));
glow += VIOLET * line(d, 0.35 * K) * dash * step(abs(surf.y - y), 40.0 * K) * P0.z * 1.2;
}
}


if (linkS >= 0.0 && !sky) {
for (int k = 0; k < 7; k++) {
float s = linkS - float(k) * 0.25;
if (s < 0.0) continue;
vec3 a = Pts[linkA(k)].xyz;
vec3 b = Pts[linkB(k)].xyz;
vec2 ab = b.xz - a.xz;
float len = length(ab);
vec2 dir = ab / len;
vec2 q = surf.xz - a.xz;
float along = dot(q, dir);
float off = dot(q, vec2(-dir.y, dir.x));
float y = mix(a.y, b.y, saturate(along / len));
if (abs(surf.y - y) > 40.0 * K || along < -8.0 * K || along > len + 8.0 * K) continue;
float head = len * saturate(s / 0.4);
float burnt = step(along, head);
float hot = exp(-sqr((along - head) / (6.0 * K))) * step(s, 0.5);
float cool = exp(-max(s - 0.4, 0.0) / 10.0);
float trace = line(abs(off), 1.1 * K) * burnt;

float cell = floor(along / (14.0 * K));
float side = mod(cell, 2.0) < 1.0 ? 1.0 : -1.0;
float bu = along - (cell + 0.5) * 14.0 * K;
float branch = line(abs(bu), 0.35 * K) * step(0.0, off * side) * step(abs(off), 10.0 * K) * step(3.0 * K, abs(off))
* step(0.4, hash11(cell + float(k) * 13.0));
float via = line(abs(length(vec2(bu, off - side * 10.0 * K)) - 1.5 * K), 0.3 * K) * step(0.4, hash11(cell + float(k) * 13.0));
float lit = trace * 2.4 + (branch + via) * burnt * 1.2;
glow += mix(VIOLET * 0.7, VIOLET_HOT, cool) * lit * (0.4 + 1.6 * cool) + WHITE_HOT * hot * exp(-abs(off) / (3.0 * K)) * 6.0;
}
}


if (finale >= 0.0) {
float f = exp(-finale * 1.2);
for (int i = 0; i < 7; i++) {
vec3 node = Pts[i].xyz;
float tCol;
float dCol = raySegmentDist(vec3(0.0), rd, node, node + vec3(0.0, skyH, 0.0), tCol);
float wc = max((2.5 + finale * 1.5) * K, tCol * gPix);
glow += (WHITE_HOT * exp(-dCol / wc) * 2.2 + VIOLET * exp(-dCol / (wc * 4.0)) * 0.35) * f * step(tCol, sceneT + 10.0 * K);
glow += glint(node + vec3(0.0, skyH, 0.0), 1.0, sceneT, VIOLET_HOT) * f;
}

for (int k = 0; k < 7; k++) {
vec3 a = Pts[linkA(k)].xyz + vec3(0.0, skyH, 0.0);
vec3 b = Pts[linkB(k)].xyz + vec3(0.0, skyH, 0.0);
float tRay;
float d = raySegmentDist(vec3(0.0), rd, a, b, tRay);
float w = max(1.5 * K, tRay * gPix);
glow += (VIOLET_HOT * exp(-d / w) * 1.6 + VIOLET * exp(-d / (w * 6.0)) * 0.3) * f * step(tRay, sceneT);
}
if (!sky) {

for (int k = 0; k < 7; k++) {
vec3 a = Pts[linkA(k)].xyz;
vec3 b = Pts[linkB(k)].xyz;
float d = sdSegment2(surf.xz, a.xz, b.xz);
glow += WHITE_HOT * exp(-d / (2.5 * K)) * f * 3.0;
}
}
}


if (P3.z > 0.001) {
for (int i = 0; i < 7; i++) {
glow += glint(Pts[i].xyz + vec3(0.0, skyH, 0.0), 0.3, sceneT, VIOLET) * P3.z;
}
}

fragColor = vec4(tonemap(base + glow), 1.0);
}
