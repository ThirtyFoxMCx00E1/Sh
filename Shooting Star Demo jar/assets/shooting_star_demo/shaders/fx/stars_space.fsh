












#include "star.glsl"

uniform sampler2D EarthDay;
uniform sampler2D EarthAux;
uniform sampler2D MoonColor;
uniform sampler2D MilkyWay;
uniform sampler2D Planets;
uniform sampler2D Rings;
uniform vec3 CamFwd;
uniform vec3 CamUp;
uniform vec3 CamRight;
uniform vec3 EarthRel;
uniform vec3 MoonRel;
uniform vec3 EarthX;
uniform vec3 EarthY;
uniform vec3 EarthZ;
uniform vec3 SunDir;
uniform vec3 SiteN;
uniform vec3 SunRelS;
uniform vec4 Planet[8];
uniform vec3 Ecliptic;
uniform vec3 SaturnPole;
uniform vec3 GalaxyN;
uniform vec3 ToCentre;
uniform vec4 Stars[7];
uniform vec4 Tints[7];
uniform vec4 Shots[7];
uniform vec3 Heading;
uniform vec4 S0;
uniform vec4 S1;
uniform vec4 S2;
uniform vec4 S3;

#include "space.glsl"

const vec3 VIOLET = vec3(0.62, 0.48, 1.0);
const vec3 VIOLET_HOT = vec3(0.86, 0.8, 1.0);
const float RSUN_LY = 7.354e-8;

vec3 texAxes(vec3 v) {
return vec3(dot(v, EarthX), dot(v, EarthY), dot(v, EarthZ));
}


vec3 groundGlow(vec3 n) {
vec3 site = texAxes(SiteN);
float near = length(n - site);
return VIOLET * (exp(-near / 0.0002) * 3.0 + exp(-near / 0.004) * 0.2) * (1.0 - S1.z * 0.0);
}

vec3 airGlow(vec3 p) {
return vec3(0.0);
}


vec3 starSurface(vec3 n, vec3 rd, vec3 tint, float seed) {
float mu = max(dot(n, -rd), 0.0);
float cells = fbm3(n * 60.0 + vec3(seed * 3.0, gTime * 0.05, 0.0));
float fine = fbm3(n * 150.0 + vec3(0.0, seed, gTime * 0.08));
float spots = smoothstep(0.64, 0.72, fbm3(n * 6.0 + seed * 3.1));
vec3 hot = mix(tint * vec3(1.0, 0.72, 0.5), tint, sqrt(mu));
return hot * (0.55 + 0.7 * cells + 0.3 * fine) * (1.0 - 0.7 * spots) * (0.3 + 1.1 * sqrt(mu)) * 60.0;
}


vec3 array(vec3 rd, vec3 c, float radius, float awake, vec3 aim, float tLimit) {
if (awake < 0.001) return vec3(0.0);
float R = max(radius, 2.0 * RSUN_LY) * 6.0;
float t = rayPlane(vec3(0.0), rd, c, aim);
vec3 col = vec3(0.0);
float dist = length(c);

vec3 dir = c / dist;
vec3 off = rd - dir * dot(rd, dir);
vec2 sq = vec2(dot(off, CamRight), dot(off, CamUp)) / gPixel;
float rr = length(sq);
float mk = 9.0 + 3.0 * (1.0 - awake);
float ticks = step(0.55, fract(atan(sq.y, sq.x) / TAU * 16.0 + gTime * 0.3));
float marker = exp(-sqr((rr - mk) / 0.9)) * ticks + exp(-sqr((rr - mk - 4.0) / 0.7)) * step(0.82, abs(cos(atan(sq.y, sq.x) * 2.0)));
float far = 1.0 - smoothstep(gPixel * 2.0, gPixel * 12.0, R * 6.0 / dist);
col += (VIOLET * marker * 1.4 + VIOLET * pointGlow(length(rd - dir), gPixel, 2.2) * 1.5) * awake * far * step(0.0, dot(rd, dir));
if (t <= 0.0 || t > tLimit || R / dist < gPixel * 2.0) return col;
vec3 q = rd * t - c;
vec3 ax, ay;
facing(aim, ax, ay);
vec2 p = vec2(dot(q, ax), dot(q, ay)) / R;
float r = length(p);
float a = atan(p.y, p.x) / TAU + 0.5;
float fp = gPixel * t / (R * max(abs(dot(rd, aim)), 0.08));
gAA = fp;
float lit = step(a, awake + 0.001);
float lines = 0.0;
for (int i = 0; i < 3; i++) {
float rr = 1.0 + float(i) * 0.28;
float seg = floor(a * (48.0 + float(i) * 24.0) + gTime * (float(i) - 1.0) * 0.4);
float bar = step(0.3, hash11(seg * 1.7 + float(i) * 11.0));
lines += line(abs(r - rr), 0.012 + 0.006 * float(i == 0 ? 1 : 0)) * bar;
lines += line(abs(r - rr - 0.035), 0.004) * 0.6;
}

float spoke = abs(fract(a * 6.0) - 0.5) / 6.0 * TAU * r;
lines += line(spoke, 0.008) * step(0.9, r) * step(r, 1.72);
vec2 tip = vec2(cos((floor(a * 6.0) + 0.5) / 6.0 * TAU - PI), sin((floor(a * 6.0) + 0.5) / 6.0 * TAU - PI)) * 1.72;
lines += line(abs(length(p - tip) - 0.05), 0.01);

lines += line(abs(r - 0.34), 0.006) * 0.8;

float sweep = exp(-sqr((fract(a - gTime * 0.35) - 0.5) / 0.02)) * step(0.9, r) * step(r, 1.7) * 0.35;
float haze = exp(-abs(r - 1.28) / 0.35) * 0.08;
col += (VIOLET * lines * 0.9 + VIOLET_HOT * lines * awake * 0.5 + VIOLET * (sweep + haze)) * lit * (0.6 + 1.2 * awake);
return col;
}

void main() {
gTime = S0.y;
gSeed = S0.z;
float tanFov = S0.x;
gPixel = 2.0 * tanFov / OutSize.y;
gPix = gPixel;
vec2 ndc = texCoord * 2.0 - 1.0;
vec2 screen = vec2(ndc.x * OutSize.x / OutSize.y, ndc.y);
vec3 rd = normalize(CamFwd + (CamRight * screen.x + CamUp * screen.y) * tanFov);

vec3 col = panorama(rd) * 0.8 + starField(rd, gPixel, 0.5);
if (S1.y > 0.001) {
vec3 hd = normalize(Heading);
float ahead = smoothstep(0.3, 0.65, dot(rd, hd));
col += warpField(rd, hd, gTime * 9.0, 2.6, gPixel, vec3(0.7, 0.66, 1.0), vec3(0.95, 0.9, 1.0)) * S1.y * ahead;
}


float tSolid = NEVER;
vec3 solid = vec3(0.0);
vec2 hs = resolvable(SunRelS, S2.x) ? raySphere(vec3(0.0), rd, SunRelS, S2.x) : vec2(-1.0);
if (hs.x > 0.0) {
tSolid = hs.x;
solid = sunBody(rd * hs.x, SunRelS, S2.x, rd, hs.x);
}
for (int i = 0; i < 8; i++) {
if (i == 2) continue;
vec3 c = Planet[i].xyz;
float R = Planet[i].w;
vec2 h = resolvable(c, R) ? raySphere(vec3(0.0), rd, c, R) : vec2(-1.0);
if (h.x > 0.0 && h.x < tSolid) {
tSolid = h.x;
solid = planetBody(i, rd * h.x, c, R, rd, h.x);
}
}
if (tSolid < NEVER) {
col = solid;
}
if (length(SunRelS) < 200.0) {
col += sunGlare(rd, SunRelS, S2.x);
} else {
col += vec3(1.0, 0.95, 0.85) * pointGlow(length(rd - normalize(SunRelS)), gPixel, 1.4) * 2.0;
}


vec3 sunLy = SunRelS * S3.y;
float tStar = NEVER;
for (int i = 0; i < 7; i++) {
vec3 c = Stars[i].xyz;
float R = Stars[i].w;
vec3 tint = Tints[i].rgb;
float dist = length(c);
vec3 dir = c / dist;
vec2 h = resolvable(c, R) ? raySphere(vec3(0.0), rd, c, R) : vec2(-1.0);
if (h.x > 0.0 && h.x < tStar) {
tStar = h.x;
col = starSurface(normalize(rd * h.x - c), rd, tint, float(i) * 7.0);
} else {
float ang = length(rd - dir);
float ar = max(R / dist, gPixel * 1.2);
float glow = pointGlow(ang, gPixel, 1.3) * 5.0 + ar * ar / (ang * ang + ar * ar) * 3.0;

vec3 off = rd - dir * dot(rd, dir);
vec2 sq = vec2(dot(off, CamRight), dot(off, CamUp)) / gPixel;
float spike = (exp(-abs(sq.y) / 0.8) * exp(-abs(sq.x) / 14.0) + exp(-abs(sq.x) / 0.8) * exp(-abs(sq.y) / 14.0));
col += tint * (glow + spike * 0.8) * step(0.0, dot(rd, dir));
}
vec3 aim = normalize(sunLy - c);
col += array(rd, c, R, Tints[i].w, aim, tStar);

float f = Shots[i].w;
if (f >= 0.0) {
float ang = length(rd - dir);
vec3 off = rd - dir * dot(rd, dir);
vec2 sq = vec2(dot(off, CamRight), dot(off, CamUp)) / gPixel;
float k = floor(atan(sq.y, sq.x) / TAU * 16.0);
float wedge = exp(-sqr((fract(atan(sq.y, sq.x) / TAU * 16.0) - 0.5) / 0.07));
float rays = wedge * exp(-length(sq) / (18.0 + 90.0 * hash11(k + float(i) * 7.0))) * step(0.55, hash11(k * 3.1 + float(i)));
float burst = exp(-f * 6.0);

float ringR = f * 900.0;
float shock = exp(-sqr((length(sq) - ringR) / (2.0 + f * 30.0))) * exp(-f * 3.0);
col += (VIOLET_HOT * (pointGlow(ang, gPixel, 5.0) * 16.0 + rays * 2.2) * burst + VIOLET * shock * 0.8)
* step(0.0, dot(rd, dir));
vec3 s = Shots[i].xyz;
float ls = length(s);
float gone = length(c - s);
if (ls > 1e-12 && gone > 1e-12) {
vec3 back = (c - s) / gone;
float trail = min(gone, ls * 0.6);
float tRay;
float d = raySegmentDist(vec3(0.0), rd, s, s + back * trail, tRay);
float w = max(tRay * gPixel * 0.8, 1e-12);
col += (VIOLET_HOT * exp(-d / w) * 1.6 + VIOLET * exp(-d / (w * 6.0)) * 0.3) * step(0.0, tRay);
col += vec3(1.0, 0.97, 1.0) * pointGlow(length(rd - s / ls), gPixel, 2.4) * 9.0;
}
}
}


float figure = max(S2.y, S2.z);
if (figure > 0.001) {
for (int k = 0; k < 7; k++) {
int ia = k == 0 ? 0 : k == 1 ? 1 : k == 2 ? 2 : k == 3 ? 3 : k == 4 ? 3 : k == 5 ? 4 : 5;
int ib = k == 0 ? 1 : k == 1 ? 2 : k == 2 ? 3 : k == 3 ? 0 : k == 4 ? 4 : k == 5 ? 5 : 6;
vec3 a = S2.z > S2.y ? normalize(Shots[ia].xyz) : normalize(Stars[ia].xyz);
vec3 b = S2.z > S2.y ? normalize(Shots[ib].xyz) : normalize(Stars[ib].xyz);
vec3 nrm = normalize(cross(a, b));
float off = abs(dot(rd, nrm));
float along = step(0.0, dot(cross(a, rd), nrm)) * step(0.0, dot(cross(rd, b), nrm));
float dash = step(0.35, fract(dot(rd, normalize(a + b)) * 900.0 + gTime * 2.0));
col += (VIOLET * exp(-off / (gPixel * 1.2)) * 2.2 + VIOLET * exp(-off / (gPixel * 6.0)) * 0.25) * along
* (0.5 + 0.5 * dash) * figure;
}
}


if (S1.x > 0.001) {
vec3 ro = -EarthRel;
vec2 he = resolvable(EarthRel, 1.0) ? raySphere(ro, rd, vec3(0.0), 1.0) : vec2(-1.0);
vec2 hm = resolvable(MoonRel, S1.w) ? raySphere(vec3(0.0), rd, MoonRel, S1.w) : vec2(-1.0);
float tEarth = he.x > 0.0 ? he.x : NEVER;
float tMoon = hm.x > 0.0 ? hm.x : NEVER;
vec3 near = col;
if (tMoon < tEarth) {
near = moonBody(rd * tMoon, MoonRel, S1.w, rd, tMoon);
} else if (he.x > 0.0) {
near = earthSurface(ro + rd * tEarth, rd, tEarth);
}
if (resolvable(EarthRel, 1.0)) {
vec3 through;
vec3 air = atmosphere(ro, rd, min(tEarth, tMoon), through);
near = near * through + air;
}
col = mix(col, near, S1.x);
}

col = 1.0 - exp(-col * 1.1);
col = pow(col, vec3(1.0 / 2.2));


float dis = S1.z;
float cover0 = S0.w;
float fog = sin(saturate(dis) * PI) * (1.0 - step(0.999, dis)) * step(S2.w, 0.5);
float mask = 1.0;
vec3 outCol = col;
if (cover0 < 0.999 || fog > 0.001) {
vec3 world = texture(DiffuseSampler, texCoord).rgb;
float r = length(screen);
float ang = atan(screen.y, screen.x);
float wisps = fbm2(vec2(ang * 2.5, log(r + 0.03) * 2.2 - dis * 7.0) + gSeed);
mask = smoothstep(wisps - 0.12, wisps + 0.12, cover0 * 1.35 - 0.2);
outCol = mix(world, col, mask);
float cloud = smoothstep(0.35, 0.8, fbm2(screen * 2.2 + vec2(0.0, -dis * 5.0) + wisps));
outCol = mix(outCol, vec3(0.92, 0.94, 1.0), fog * (0.35 + 0.65 * cloud) * 0.95);
}
fragColor = vec4(outCol, 1.0 - mask);
}
