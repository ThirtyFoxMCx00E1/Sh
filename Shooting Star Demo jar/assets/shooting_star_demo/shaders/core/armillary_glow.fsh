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

float hash11(float p) {
p = fract(p * 0.1031);
p *= p + 33.33;
p *= p + p;
return fract(p);
}

float segment(vec2 p, vec2 a, vec2 b) {
vec2 pa = p - a;
vec2 ba = b - a;
return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}


float glyph(vec2 uv, float id) {
float d = 1e3;
for (int i = 0; i < 16; i++) {
if (hash11(id * 17.0 + float(i) * 3.1) < 0.6) continue;
vec2 a;
vec2 b;
int k = i;
if (k < 6) {
a = vec2(float(k % 2) * 0.5, float(k / 2) * 0.5);
b = a + vec2(0.5, 0.0);
} else if (k < 12) {
k -= 6;
a = vec2(float(k / 2) * 0.5, float(k % 2) * 0.5);
b = a + vec2(0.0, 0.5);
} else {
k -= 12;
a = vec2(float(k % 2) * 0.5, float(k / 2) * 0.5);
b = a + vec2(0.5, 0.5);
if (hash11(id + float(k)) > 0.5) { a.x += 0.5; b.x -= 0.5; }
}
d = min(d, segment(uv, a * 0.8 + 0.1, b * 0.8 + 0.1));
}
return d;
}

void main() {
vec2 uv = texCoord0;
float kind = floor((uv.x + 2.0) / 4.0);
uv.x -= kind * 4.0;
float id = floor((uv.y + 2.0) / 4.0);
uv.y -= id * 4.0;
float r2 = dot(uv, uv);
float edge = clamp(1.0 - r2, 0.0, 1.0);
edge *= edge;
float shape;
if (kind < 0.5) {

shape = (exp(-r2 * 9.0) * 0.75 + exp(-r2 * 3.0) * 0.25) * edge;
} else if (kind < 1.5) {
float r = sqrt(r2);

float q1 = (r - 0.82) / 0.035;
float q2 = (r - 0.82) / 0.12;
shape = (exp(-q1 * q1) + 0.35 * exp(-q2 * q2)) * edge;
} else if (kind < 2.5) {
vec2 a = abs(uv);
shape = (exp(-a.x * 22.0) * exp(-a.y * 2.6) + exp(-a.y * 22.0) * exp(-a.x * 2.6)
+ exp(-r2 * 30.0) * 1.5) * edge;
} else {
float d = glyph(uv * 0.5 + 0.5, id);
shape = (smoothstep(0.075, 0.025, d) + exp(-d * 14.0) * 0.4) * step(max(abs(uv.x), abs(uv.y)), 1.0);
}
float a = vertexColor.a * shape;
if (a < 0.003) {
discard;
}
fragColor = vec4(vertexColor.rgb, a) * ColorModulator;
}
