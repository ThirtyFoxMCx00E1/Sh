


const vec3 LASER = vec3(1.0, 0.045, 0.07);
const vec3 LASER_HOT = vec3(1.0, 0.55, 0.6);
const vec3 HUD_CYAN = vec3(0.3, 0.85, 1.0);

float gTime;
float gSeed;

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

vec2 sphereUV(vec3 n) {
return vec2(0.5 + atan(n.x, n.z) / TAU, 0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI);
}


float lodFor(float arc, float width) {
return log2(max(arc * width / TAU, 1e-3));
}

vec3 blackbody(float x) {
vec3 c = mix(vec3(0.3, 0.01, 0.0), vec3(1.0, 0.25, 0.02), smoothstep(0.0, 0.45, x));
c = mix(c, vec3(1.0, 0.68, 0.22), smoothstep(0.4, 0.85, x));
return mix(c, vec3(1.0, 0.95, 0.85), smoothstep(0.85, 1.25, x));
}


float pointGlow(float d, float pix, float size) {
float x = d / (pix * size);
return exp(-x * x) + 0.06 / (1.0 + x * x * 0.4);
}


void facing(vec3 n, out vec3 ax, out vec3 ay) {
ax = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
ay = cross(ax, n);
}




vec3 starField(vec3 rd, float pix, float gain) {
vec3 col = vec3(0.0);
for (int layer = 0; layer < 3; layer++) {
float fl = float(layer);
float scale = layer == 0 ? 110.0 : layer == 1 ? 260.0 : 520.0;
vec3 id = floor(rd * scale);
float h = hash13(id + fl * 17.0 + gSeed);
if (h > (layer == 0 ? 0.05 : 0.03)) continue;
vec3 sd = normalize(id + 0.2 + 0.6 * vec3(hash13(id + 3.1), hash13(id + 7.7), hash13(id + 11.3)));
float a = length(rd - sd);
float size = layer == 0 ? 1.1 : 0.8;
float mag = sqr(sqr(hash13(id + 5.9))) * hash13(id + 5.9) * (layer == 0 ? 9.0 : 2.5) + (layer == 2 ? 0.12 : 0.2);
float twinkle = 0.78 + 0.22 * sin(gTime * (2.0 + h * 40.0) + h * 97.0);
vec3 tint = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.84, 0.64), hash13(id + 2.3));
col += tint * mag * twinkle * exp(-sqr(a / (pix * size))) * 0.35;
}
return col * gain;
}


vec3 deepField(vec3 rd, float pix) {
vec3 col = vec3(0.0);
for (int layer = 0; layer < 3; layer++) {
float fl = float(layer);
float scale = layer == 0 ? 34.0 : layer == 1 ? 75.0 : 160.0;
vec3 cell = floor(rd * scale);
float h = hash13(cell + gSeed + fl * 31.0);
if (h > (layer == 0 ? 0.05 : layer == 1 ? 0.06 : 0.08)) continue;
vec3 c = normalize(cell + 0.3 + 0.4 * vec3(hash13(cell + 1.3), hash13(cell + 2.9), hash13(cell + 5.1)));
vec3 ax, ay;
facing(c, ax, ay);
vec3 d = rd - c;
vec2 q = vec2(dot(d, ax), dot(d, ay)) / pix;
q = rot(hash13(cell + 7.7) * TAU) * q;
float size = (layer == 0 ? 3.4 : layer == 1 ? 2.0 : 1.3) * (0.5 + hash13(cell + 11.0));
q.y /= mix(0.22, 1.0, hash13(cell + 9.1));
float r = length(q) / size;
if (r > 4.0) continue;
float spiral = step(0.45, hash13(cell + 13.0));
float arms = spiral * (0.55 + 0.45 * sin(2.0 * atan(q.y, q.x + 1e-6) - 4.0 * log(r + 0.15)));
float body = exp(-r * r * 1.4) * mix(1.0, arms, 0.6 * spiral) + exp(-r * r * 14.0) * 0.9;
vec3 tint = mix(vec3(1.0, 0.78, 0.5), vec3(0.62, 0.74, 1.0), hash13(cell + 17.0));
col += tint * body * (layer == 0 ? 0.24 : layer == 1 ? 0.14 : 0.09);
}
return col;
}






vec3 warpField(vec3 rd, vec3 heading, float phase, float streak, float pix, vec3 tintA, vec3 tintB) {
float c = dot(rd, heading);
if (c <= 0.02) return vec3(0.0);
vec3 hx, hy;
facing(heading, hx, hy);
vec2 p = vec2(dot(rd, hx), dot(rd, hy)) / c;
float r = max(length(p), 1e-5);
float phi = atan(p.y, p.x + 1e-7);
float u = log(r);
float px = pix * (1.0 + r * r);
vec3 col = vec3(0.0);
for (int layer = 0; layer < 3; layer++) {
float fl = float(layer);
float du = 0.22 + 0.1 * fl;
float around = 70.0 + 45.0 * fl;
float drift = phase * (1.0 + 0.35 * fl);
vec2 cell = vec2(floor((u - drift) / du), floor((phi / TAU + 0.5) * around));
float h = hash12(cell + fl * 17.0 + gSeed);
if (h > 0.14) continue;
float cu = (cell.x + 0.15 + 0.7 * hash12(cell + 3.1)) * du + drift;
float cv = ((cell.y + 0.2 + 0.6 * hash12(cell + 5.3)) / around - 0.5) * TAU;
vec2 o = exp(cu) * vec2(cos(cv), sin(cv));
vec2 radial = vec2(cos(cv), sin(cv));
vec2 dl = p - o;
float along = dot(dl, radial);
float across = dot(dl, vec2(-radial.y, radial.x));
float len = px * (1.3 + streak * exp(cu) * 90.0);

float wide = px * (streak > 0.5 ? 0.7 : 1.1 + 0.6 * fl);
float head = along < 0.0 ? along / len : along / (px * 1.5);
float d = length(vec2(head, across / wide));
float tail = streak > 0.5 ? mix(0.35, 1.0, saturate(along / len + 1.0)) : 1.0;
float near = smoothstep(-5.0, -1.5, cu);
col += mix(tintA, tintB, hash12(cell + 9.0)) * exp(-d * d) * tail * near * (0.6 - 0.15 * fl) * (streak > 0.5 ? 1.6 : 1.0);
}
return col;
}








vec3 galaxyDisc(vec3 rd, vec3 centre, vec3 n, vec3 ey, float radius, sampler2D tex, float pix, float tLimit,
out float cover, out float tHit) {
cover = 0.0;
tHit = -1.0;
float t = rayPlane(vec3(0.0), rd, centre, n);
if (t <= 0.0 || t > tLimit) return vec3(0.0);
vec3 q = rd * t - centre;
vec3 ex = normalize(cross(ey, n));
vec2 uv = vec2(dot(q, ex), dot(q, ey)) / (2.0 * radius) + 0.5;
if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
float slant = abs(dot(rd, n));
float lod = log2(max(pix * t / max(slant, 0.04) / (2.0 * radius) * 2048.0, 1e-3));
vec3 c = toLinear(textureLod(tex, vec2(uv.x, 1.0 - uv.y), lod).rgb);
tHit = t;
cover = saturate(lum(c) * 3.0);
return c * mix(1.0, min(1.0 / max(slant, 0.1), 3.0), 0.4);
}
