import * as THREE from 'three';
import { EARTH_RADIUS, SITE, siteToWorldRotation } from './geo';

// The whole Earth for high altitudes: a textured sphere (NASA Blue Marble),
// a cloud layer just above it, and a glowing atmosphere shell.
// Textures are in public/textures/earth (NASA images are public domain).

const TEXTURES = `${import.meta.env.BASE_URL}textures/earth/`;

const CLOUD_HEIGHT = 6_000;        // m above the surface
const ATMOSPHERE_HEIGHT = 100_000; // thickness of the glow shell
const ATMOSPHERE_FALLOFF = 25_000; // how quickly the glow fades with height

// The atmosphere is a custom shader. For each pixel it finds how close the
// line of sight passes to Earth's center: rays that just skim the surface
// go through the most air and glow brightest, fading with height above it.
// The logdepthbuf lines keep it working with the logarithmic depth buffer
// the scene uses to cover both meters and thousands of kilometers.
const atmosphereVertex = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vWorldPos;
    void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
    }
`;
const atmosphereFragment = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 earthCenter;
    uniform float earthRadius;
    uniform float falloff;
    uniform float opacity;
    varying vec3 vWorldPos;
    void main() {
        #include <logdepthbuf_fragment>
        vec3 dir = normalize(vWorldPos - cameraPosition);
        vec3 toCenter = earthCenter - cameraPosition;
        // Closest the view ray gets to Earth's center
        float closest = length(toCenter - dir * dot(toCenter, dir));
        float height = max(closest - earthRadius, 0.0);
        float glow = exp(-height / falloff);
        gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * glow * opacity, 1.0);
    }
`;


export function createGlobe() {
    // Earth's center is EARTH_RADIUS straight below the pad
    const group = new THREE.Group();
    group.position.set(0, -EARTH_RADIUS, 0);
    group.quaternion.copy(siteToWorldRotation(SITE.lat, SITE.lon));

    const loader = new THREE.TextureLoader();
    const surfaceMap = loader.load(`${TEXTURES}blue-marble-5400.jpg`);
    surfaceMap.colorSpace = THREE.SRGBColorSpace;
    surfaceMap.anisotropy = 8;
    const cloudMap = loader.load(`${TEXTURES}clouds-2048.jpg`);

    // Slightly smaller than the real radius: the flat triangles between
    // vertices cut a little inside the true curve, and this keeps the globe
    // safely under the detailed terrain patches near the pad
    const earth = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_RADIUS - 300, 512, 256),
        new THREE.MeshBasicMaterial({ map: surfaceMap }),
    );
    group.add(earth);

    // The cloud image is grayscale, so it works as an alpha map: white =
    // solid cloud, black = see-through
    const cloudMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        alphaMap: cloudMap,
        transparent: true,
        depthWrite: false,
        opacity: 0,
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS + CLOUD_HEIGHT, 256, 128), cloudMaterial);
    clouds.renderOrder = 3;
    group.add(clouds);

    const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        uniforms: {
            earthCenter: { value: group.position.clone() },
            earthRadius: { value: EARTH_RADIUS },
            falloff: { value: ATMOSPHERE_FALLOFF },
            opacity: { value: 0 },
        },
        side: THREE.BackSide,          // draw the far inside of the shell, so it shows around the limb
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_RADIUS + ATMOSPHERE_HEIGHT, 128, 64),
        atmosphereMaterial,
    );
    atmosphere.renderOrder = 4;
    group.add(atmosphere);

    return {
        group,
        // Called every frame with the camera's height above the ground
        update(altitude: number, dt: number) {
            // Clouds appear as you climb past them and become a layer below
            cloudMaterial.opacity = 0.9 * THREE.MathUtils.smoothstep(altitude, 10_000, 60_000);
            // The glow ring only makes sense once you can see the curve
            atmosphereMaterial.uniforms.opacity.value = THREE.MathUtils.smoothstep(altitude, 20_000, 120_000);
            // Slow drift so the clouds don't look painted on
            clouds.rotation.y += dt * 0.0005;
        },
    };
}
