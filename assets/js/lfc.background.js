// LFC Background: Neon-Orange Tech-Scan (keine grünen Werte!)
(function () {
  const NEON = { r: 255, g: 175, b: 35 };   // helles Neon-Orange
  const HOT  = { r: 255, g: 210, b: 95 };   // warmes Glow-Orange 

  // ------------------------
  // Punkte + Parallax
  // ------------------------
  const LAYER_COUNT = 4;
  const POINTS_PER_LAYER = 15;

  const pointsContainer = document.getElementById("bt-points");
  const pointLayers = [];

  if (pointsContainer) {
    pointsContainer.innerHTML = "";

    for (let i = 0; i < LAYER_COUNT; i++) {
      const layer = document.createElement("div");
      layer.className = "bt-points-layer";

      // twinkle pro Layer
      layer.style.animationDelay = (Math.random() * 6).toFixed(2) + "s";
      layer.style.animationDuration = (7 + Math.random() * 7).toFixed(2) + "s";

      layer.dataset.depth = (0.28 + (i / LAYER_COUNT) * 0.78).toFixed(2);

      const imgs = [];
      const sizes = [];
      const positions = [];
      const repeats = [];

      for (let p = 0; p < POINTS_PER_LAYER; p++) {
        const size = (Math.random() * 8 + 2.0).toFixed(1); // 2–10px
        const x = (Math.random() * 100).toFixed(1) + "%";
        const y = (Math.random() * 100).toFixed(1) + "%";

        const alpha = (Math.random() * 0.50 + 0.42).toFixed(2); // 0.42–0.92
        const useHot = Math.random() > 0.55;
        const col = useHot ? HOT : NEON;

        // 1 Gradient pro Punkt (solides Quadrat)
        imgs.push(
          `linear-gradient(rgba(${col.r},${col.g},${col.b},${alpha}), rgba(${col.r},${col.g},${col.b},${alpha}))`
        );

        sizes.push(`${size}px ${size}px`);
        positions.push(`${x} ${y}`);
        repeats.push("no-repeat");
      }

      layer.style.backgroundImage = imgs.join(",");
      layer.style.backgroundSize = sizes.join(",");
      layer.style.backgroundPosition = positions.join(",");
      layer.style.backgroundRepeat = repeats.join(",");

      pointsContainer.appendChild(layer);
      pointLayers.push(layer);
    }

    let mouseX = 0.5, mouseY = 0.5, scrollY = 0;

    window.addEventListener("mousemove", (e) => {
      mouseX = e.clientX / window.innerWidth;
      mouseY = e.clientY / window.innerHeight;
    });

    window.addEventListener("scroll", () => {
      scrollY = window.scrollY || window.pageYOffset || 0;
    });

    function animate() {
      const h = window.innerHeight || 1;
      for (const layer of pointLayers) {
        const depth = parseFloat(layer.dataset.depth || "0.5");
        const offsetX = (mouseX - 0.5) * depth * 34;
        const offsetY = (mouseY - 0.5) * depth * 18 + (scrollY / h) * depth * 26;
        layer.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
      }
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ------------------------
  // Glow-Orbits (NEON / Rechtecke)
  // ------------------------
  const orbitContainer = document.getElementById("bt-glow-orbits");
  if (orbitContainer) {
    orbitContainer.innerHTML = "";

    const ORBIT_MIN = 3;
    const ORBIT_MAX = 7;
    const orbitCount = ORBIT_MIN + Math.floor(Math.random() * (ORBIT_MAX - ORBIT_MIN + 1));

    for (let i = 0; i < orbitCount; i++) {
      const orbit = document.createElement("div");
      orbit.className = "bt-orbit";

      const w = Math.random() * 420 + 260; // 260–680
      const h = Math.random() * 260 + 180; // 180–440
      orbit.style.width = w.toFixed(0) + "px";
      orbit.style.height = h.toFixed(0) + "px";

      orbit.style.left = (Math.random() * 78 + 6) + "%";
      orbit.style.top  = (Math.random() * 78 + 6) + "%";

      orbit.style.setProperty("--orbit-offset-x", (Math.random() * 26 - 13).toFixed(1) + "px");
      orbit.style.setProperty("--orbit-offset-y", (Math.random() * 26 - 13).toFixed(1) + "px");
      orbit.style.setProperty("--orbit-rot", (Math.random() * 360).toFixed(0) + "deg");

      const duration = (Math.random() * 22 + 34).toFixed(1);
      orbit.style.animationDuration = duration + "s";
      orbit.style.animationDirection = Math.random() > 0.5 ? "normal" : "reverse";

      const aB = (0.20 + Math.random() * 0.24).toFixed(2);
      const aG = (0.20 + Math.random() * 0.34).toFixed(2);

      orbit.style.borderColor = `rgba(${NEON.r},${NEON.g},${NEON.b},${aB})`;
      orbit.style.boxShadow =
        `0 0 18px rgba(${NEON.r},${NEON.g},${NEON.b},${aG}),
         0 0 42px rgba(${HOT.r},${HOT.g},${HOT.b},${(aG * 0.35).toFixed(2)})`;

      orbitContainer.appendChild(orbit);
    }
  }
})();
