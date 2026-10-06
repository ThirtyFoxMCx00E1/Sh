#version 330


















layout(std140) uniform DynamicTransforms {
mat4 ModelViewMat;
vec4 ColorModulator;
vec3 ModelOffset;
mat4 TextureMat;
};
layout(std140) uniform Globals {
ivec3 CameraBlockPos;
vec3 CameraOffset;
vec2 ScreenSize;
float GlintAlpha;
float GameTime;
int MenuBlurRadius;
int UseRgss;
};

uniform sampler2D Sampler0;

in vec2 texCoord0;
in vec4 vertexColor;

out vec4 fragColor;

const vec3 WHITE = vec3(1.0);
const vec3 RIM = vec3(0.66, 0.86, 1.0);
const vec3 RIM_HOT = vec3(0.9, 0.97, 1.0);
const float TAU = 6.2831853;

vec3 gCol = vec3(0.0);
float gA = 0.0;

float sqr(float x) {
return x * x;
}

float grain(vec2 p) {
return texture(Sampler0, fract(p / 64.0)).r;
}

vec3 rgb565(float hi, float lo) {
float v = hi * 256.0 + lo;
return vec3(floor(v / 2048.0) / 31.0, mod(floor(v / 32.0), 64.0) / 63.0, mod(v, 32.0) / 31.0);
}

float roundBox(vec2 p, vec2 half_, float r) {
vec2 q = abs(p) - half_ + r;
return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float corner(int flags, vec2 size) {
int c = flags & 3;
return c == 0 ? 2.0 : c == 1 ? 4.0 : c == 2 ? 8.0 : min(size.x, size.y) * 0.5;
}

void put(vec3 col, float a) {
gCol = col;
gA = clamp(a, 0.0, 1.0);
}

void plate(vec2 q, vec2 size, vec2 st, vec3 fill, float alpha, int flags, float aa) {
float r = min(corner(flags, size), min(size.x, size.y) * 0.5);
float d = roundBox(q - size * 0.5, size * 0.5, r);
float cov = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);

vec3 col = fill + (1.0 - fill) * 0.3 * (1.0 - st.y);
float top = (1.0 - smoothstep(0.0, max(aa, 0.6), q.y - 0.6)) * step(r, q.x) * step(q.x, size.x - r);
col = mix(col, WHITE, top * 0.55);
if ((flags & 4) != 0) {
float bw = max(0.6, aa);
float band = smoothstep(-bw - aa * 0.5, -bw + aa * 0.5, d);
col = mix(col, fill * 0.82, band);
}
put(col, cov * alpha);
}

void shadow(vec2 q, vec2 size, vec3 tint, float alpha, int flags) {
float m = (flags & 4) != 0 ? 16.0 : 8.0;
vec2 inner = size - 2.0 * m;
float r = min(corner(flags, inner), min(inner.x, inner.y) * 0.5);
float d = roundBox(q - size * 0.5, inner * 0.5, r);
float sigma = m / 2.6;
float a = exp(-sqr(max(d, 0.0)) / (2.0 * sigma * sigma)) * (1.0 - smoothstep(m * 0.9, m, d));
a += (grain(gl_FragCoord.xy) - 0.5) / 255.0;
put(tint, a * alpha);
}

void disc(vec2 q, vec2 size, vec2 st, vec3 col, float alpha, int flags, float aa) {
float rad = min(size.x, size.y) * 0.5;
float dist = length(q - size * 0.5);
float d = dist - (rad - aa * 0.5);
int style = flags & 7;
if (style == 2) {
float k = 1.0 - smoothstep(rad * 0.35, rad, dist);
put(col, k * k * alpha);
return;
}
if (style == 1 || style == 3) {
float w = style == 1 ? 1.1 : 2.2;
float cov = 1.0 - smoothstep(w * 0.5 - aa * 0.5, w * 0.5 + aa * 0.5, abs(d + w * 0.5));
put(col, cov * alpha);
return;
}
float cov = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
vec3 face = col;
if (style == 4) {

face = col + (1.0 - col) * 0.35 * (1.0 - st.y) - col * 0.06 * st.y;
float rim = 1.0 - smoothstep(0.0, max(1.2, aa * 1.5), -d);
face = mix(face, WHITE, rim * 0.5 * (1.0 - st.y));
}
put(face, cov * alpha);
}

void arc(vec2 q, vec2 size, vec3 col, float frac, float alpha, float aa) {
vec2 p = q - size * 0.5;
float rad = min(size.x, size.y) * 0.5 - 1.5;
float ring = 1.0 - smoothstep(1.0 - aa * 0.5, 1.0 + aa * 0.5, abs(length(p) - rad));
float a = atan(p.x, -p.y);
a = a < 0.0 ? a + TAU : a;
float lit = step(a / TAU, frac);
put(col, ring * mix(0.18, 1.0, lit) * alpha);
}

void wipe(float p, float alpha) {
vec2 c = ScreenSize * 0.5;
vec2 d = gl_FragCoord.xy - c;
float maxR = length(c);
float ang = atan(d.y, d.x);

float n = grain(vec2(ang / TAU * 192.0, p * 22.0)) * 0.6 + grain(vec2(ang / TAU * 64.0 + 17.0, p * 9.0)) * 0.4;
float rad = p * maxR * 1.12 + (n - 0.5) * maxR * 0.07 * (1.0 - p);
float dist = length(d) - rad;
float inside = 1.0 - smoothstep(-1.5, 1.5, dist);
float rimW = maxR * mix(0.05, 0.02, p);
float rim = exp(-sqr(dist / rimW)) * (1.0 - smoothstep(0.85, 1.0, p));
float hot = exp(-sqr(dist / (rimW * 0.35)));

float veil = 0.22 * p * (1.0 - inside);
vec3 col = mix(WHITE, mix(RIM, RIM_HOT, hot), clamp(rim * 1.5, 0.0, 1.0));
col = mix(col, WHITE, inside);
put(col, max(inside, max(rim * 0.9, veil)) * alpha);
}



void mirrorShard(vec2 st, vec2 centre, float tilt, float zoom, float alpha, bool cracking) {
float e1 = -st.x;
float e2 = -st.y;
float e3 = st.x + st.y - 1.0;
float d = max(e1 / max(fwidth(e1), 1e-5), max(e2 / max(fwidth(e2), 1e-5), e3 / max(fwidth(e3), 1e-5)));
float cov = clamp(0.5 - d, 0.0, 1.0);
vec2 c = vec2(centre.x, 1.0 - centre.y) * ScreenSize;
vec2 p = gl_FragCoord.xy - c;
p.x = -p.x;
p = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * p / zoom;


vec2 source = c;
if (abs(tilt) > 1.5708) {
source.y = ScreenSize.y - c.y;
} else {
source.x += sin(tilt) * ScreenSize.x * 0.3;
}
vec2 uv = clamp((source + p) / ScreenSize, vec2(0.001), vec2(0.999));
vec3 scene = texture(Sampler0, uv).rgb;

vec3 col = scene * 0.96 + vec3(0.02, 0.03, 0.045);
float sheen = exp(-sqr((st.x - st.y + sin(tilt * 3.0) * 0.7) * 2.6));
col += vec3(0.85, 0.92, 1.0) * sheen * 0.16;
float edge = exp(-sqr(d / (cracking ? 2.4 : 1.5)));
float parting = exp(-sqr((d + 2.8) / 1.0));
col *= 1.0 - 0.35 * parting;
col = mix(col, RIM_HOT, edge * 0.8);
put(col, cov * alpha);
}

void shard(vec2 st, vec3 tint, float alpha, int flags) {
float e1 = -st.x;
float e2 = -st.y;
float e3 = st.x + st.y - 1.0;
float d1 = e1 / max(fwidth(e1), 1e-5);
float d2 = e2 / max(fwidth(e2), 1e-5);
float d3 = e3 / max(fwidth(e3), 1e-5);
float d = max(d1, max(d2, d3));
float cov = clamp(0.5 - d, 0.0, 1.0);
if ((flags & 2) != 0) {
put(tint, cov * alpha);
return;
}

float edge = exp(-sqr(d / ((flags & 1) != 0 ? 2.2 : 1.4)));
vec3 col = mix(tint, RIM_HOT, edge * 0.8);
col = mix(col, RIM, edge * 0.25 * (1.0 - st.y));
put(col, cov * alpha * mix(0.92, 1.0, edge));
}

void reticle(vec2 q, vec2 size, vec3 col, float hover, float alpha, float aa) {
vec2 p = q - size * 0.5;
float r = mix(7.0, 5.0, hover);
float ring = 1.0 - smoothstep(0.55 - aa * 0.5, 0.55 + aa * 0.5, abs(length(p) - r));
float turn = hover * 0.785398;
vec2 rp = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * p;
vec2 ap = abs(rp);
float along = max(ap.x, ap.y);
float across = min(ap.x, ap.y);
float tick = (1.0 - smoothstep(0.5 - aa * 0.5, 0.5 + aa * 0.5, across))
* step(r + 2.0, along) * (1.0 - smoothstep(r + 5.5 - aa, r + 5.5, along));
float dot_ = 1.0 - smoothstep(1.0 - aa * 0.5, 1.0 + aa * 0.5, length(p));
put(col, max(max(ring, tick), dot_) * alpha);
}

void rule(vec2 q, vec2 size, vec3 col, float drawn, int flags, float aa) {
float y = abs(q.y - size.y * 0.5);
float line = 1.0 - smoothstep(0.45 - aa * 0.5, 0.45 + aa * 0.5, y);
float ends = (flags & 4) != 0 ? 1.0 : (flags & 1) != 0 ? smoothstep(0.0, size.x, q.x)
: (flags & 2) != 0 ? smoothstep(size.x, 0.0, q.x)
: smoothstep(0.0, size.x * 0.12, q.x) * smoothstep(size.x, size.x * 0.88, q.x);
float head = drawn * size.x;
float body = 1.0 - smoothstep(head - 2.0, head, q.x);
float spark = exp(-sqr((q.x - head) / 4.0)) * exp(-sqr(y / 1.4)) * (1.0 - smoothstep(0.92, 1.0, drawn));
put(mix(col, RIM_HOT, spark), max(line * ends * body, spark));
}

void main() {
vec2 size = floor(texCoord0);
vec2 st = (texCoord0 - size - 0.25) * 2.0;
vec2 q = st * size;
vec4 c = vertexColor;
float r = floor(c.r * 255.0 + 0.5);
float g = floor(c.g * 255.0 + 0.5);
float b = floor(c.b * 255.0 + 0.5);
int aByte = int(floor(c.a * 255.0 + 0.5));
int mode = aByte & 15;
int flags = (aByte >> 4) & 7;

float aa = max(length(fwidth(q)) * 0.7071, 1e-4);
vec3 col = rgb565(r, g);
float a8 = b / 255.0;
float eighths = float(flags + 1) / 8.0;

if (mode == 0) {
plate(q, size, st, col, a8, flags, aa);
} else if (mode == 1) {
shadow(q, size, col, a8, flags);
} else if (mode == 2) {
disc(q, size, st, col, a8, flags, aa);
} else if (mode == 3) {
arc(q, size, col, a8, eighths, aa);
} else if (mode == 4) {
wipe((r * 256.0 + g) / 65535.0, a8);
} else if (mode == 5 && (flags & 4) != 0) {
mirrorShard(st, size / 2048.0, (r / 255.0 - 0.5) * 6.2831853, 0.8 + g / 255.0 * 0.5, a8, (flags & 1) != 0);
} else if (mode == 5) {
shard(st, col, a8, flags);
} else if (mode == 6) {
reticle(q, size, col, a8, eighths, aa);
} else if (mode == 7) {
rule(q, size, col, a8, flags, aa);
}
if (gA <= 0.003) {
discard;
}
fragColor = vec4(min(gCol, vec3(1.0)), gA) * ColorModulator;
}
