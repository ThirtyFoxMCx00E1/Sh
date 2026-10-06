


void main() {
gl_FragDepth = texture(DepthSampler, texCoord).r;
fragColor = vec4(0.0);
}
