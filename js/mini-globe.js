let size = 400;
let landFeatures = [];
let pulseLayer;
let globeProjection;
let activePulses = [];
let rotation = [0, 0, 0];
let landPaths;
let globePath;
let lastPulseTime = 0;
const PULSE_INTERVAL = 500;

function createMiniGlobe(containerId) {
    const container = d3.select(containerId);
    container.html(''); // Clear any existing content
    
    const svg = container
        .append("svg")
        .attr("width", size)
        .attr("height", size)
        .style("border-radius", "50%")
        .style("box-shadow", "0 0 60px rgba(74, 144, 226, 0.3)")
        .style("background", "#0c1e35") // Dark blue background
        .style("overflow", "hidden");

    // Add a subtle gradient for the ocean
    const defs = svg.append("defs");
    
    // Ocean gradient
    const oceanGradient = defs.append("linearGradient")
        .attr("id", "ocean-gradient")
        .attr("x1", "0%")
        .attr("y1", "0%")
        .attr("x2", "100%")
        .attr("y2", "100%");
    
    oceanGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "#1e3c72");
    
    oceanGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "#2a5298");

    // Ocean background with gradient
    svg.append("circle")
        .attr("cx", size / 2)
        .attr("cy", size / 2)
        .attr("r", size / 2 - 10)
        .attr("fill", "url(#ocean-gradient)")
        .attr("stroke", "#3a5a8a")
        .attr("stroke-width", 1.5)
        .style("opacity", 0.95);

    // Land gradient
    const landGradient = defs.append("linearGradient")
        .attr("id", "land-gradient")
        .attr("x1", "0%")
        .attr("y1", "0%")
        .attr("x2", "100%")
        .attr("y2", "100%");
    
    landGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "#4a6b3f");
    
    landGradient.append("stop")
        .attr("offset", "50%")
        .attr("stop-color", "#3a5a2f");
    
    landGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "#2a4a1f");

    // Create groups for proper layering
    const globeGroup = svg.append("g").attr("class", "globe-group");
    pulseLayer = svg.append("g").attr("class", "pulse-layer");

    globeProjection = d3.geoOrthographic()
        .scale(size / 2 - 12)
        .translate([size / 2, size / 2])
        .clipAngle(90);

    globePath = d3.geoPath().projection(globeProjection);

    d3.json("data/world-110m.json").then(world => {
        landFeatures = world.features;

        // Pre-process features to ensure proper rendering
        landFeatures.sort((a, b) => {
            // Sort large polygons first to reduce overdraw artifacts
            const aArea = d3.geoArea(a);
            const bArea = d3.geoArea(b);
            return bArea - aArea;
        });

        // Draw land with better contrast and no flicker
        landPaths = globeGroup.selectAll("path")
            .data(landFeatures)
            .enter()
            .append("path")
            .attr("fill", "url(#land-gradient)")
            .attr("stroke", "#2a3a2a")
            .attr("stroke-width", 0.5)
            .attr("vector-effect", "non-scaling-stroke")
            .style("shape-rendering", "geometricPrecision");

        // Add subtle shadow for depth
        const shadowFilter = defs.append("filter")
            .attr("id", "drop-shadow")
            .attr("x", "-50%")
            .attr("y", "-50%")
            .attr("width", "200%")
            .attr("height", "200%");
        
        shadowFilter.append("feGaussianBlur")
            .attr("in", "SourceAlpha")
            .attr("stdDeviation", 2)
            .attr("result", "blur");
        
        shadowFilter.append("feOffset")
            .attr("in", "blur")
            .attr("dx", 1)
            .attr("dy", 1)
            .attr("result", "offsetBlur");
        
        const feMerge = shadowFilter.append("feMerge");
        feMerge.append("feMergeNode")
            .attr("in", "offsetBlur");
        feMerge.append("feMergeNode")
            .attr("in", "SourceGraphic");

        // Add land highlight for better contrast
        landPaths.attr("filter", "url(#drop-shadow)");

        // Animation loop
        let animationId = null;
        
        function animate() {
            rotation[0] += 0.15;
            globeProjection.rotate(rotation);
            
            // Batch update land paths to reduce DOM operations
            landPaths.attr("d", globePath);
            
            // Update pulse positions with projection
            pulseLayer.selectAll("circle.pulse").each(function() {
                const id = d3.select(this).attr("data-id");
                const pulseData = activePulses.find(p => p.id.toString() === id);
                if (pulseData) {
                    const projected = globeProjection(pulseData.coords);
                    if (projected) {
                        d3.select(this)
                            .attr("cx", projected[0])
                            .attr("cy", projected[1]);
                    } else {
                        // If point goes behind globe, fade it out
                        const currentOpacity = parseFloat(d3.select(this).attr("opacity"));
                        if (currentOpacity > 0.1) {
                            d3.select(this).attr("opacity", currentOpacity * 0.8);
                        }
                    }
                }
            });
            
            animationId = requestAnimationFrame(animate);
        }

        // Start animation
        animate();

        // Spawn pulses with proper timing
        function scheduleNextPulse() {
            const now = Date.now();
            if (now - lastPulseTime >= PULSE_INTERVAL) {
                spawnDeathPulse();
                lastPulseTime = now;
            }
            setTimeout(scheduleNextPulse, PULSE_INTERVAL);
        }
        
        scheduleNextPulse();

        // Handle visibility changes to stop flickering
        let isVisible = true;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isVisible = entry.isIntersecting;
                if (!isVisible && animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                } else if (isVisible && !animationId) {
                    animate();
                }
            });
        }, { threshold: 0.1 });
        
        observer.observe(svg.node());

    }).catch(error => {
        console.error("Error loading world data:", error);
        createFallbackGlobe(svg);
    });

    // Cleanup function
    return () => {
        if (pulseLayer) pulseLayer.selectAll("*").remove();
    };
}

function randomVisibleLandLatLon() {
    if (!landFeatures.length) return [0, 0];
    
    let attempts = 0;
    while (attempts < 200) {
        attempts++;
        const feature = landFeatures[Math.floor(Math.random() * landFeatures.length)];
        if (!feature) continue;
        
        // Get the centroid of the feature
        let point;
        try {
            point = d3.geoCentroid(feature);
        } catch (e) {
            continue;
        }
        
        if (!point) continue;
        
        // Check if point is on land
        if (!isPointInLand(point)) continue;
        
        // Check if point is visible (on front hemisphere)
        const projected = globeProjection(point);
        if (!projected) continue;
        
        // Check if within visible hemisphere
        const dx = projected[0] - size / 2;
        const dy = projected[1] - size / 2;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const maxRadius = size / 2 - 15;
        
        if (radius > maxRadius) continue;
        
        return point;
    }
    
    // Fallback to random point on visible land
    for (let i = 0; i < 50; i++) {
        const lon = Math.random() * 360 - 180;
        const lat = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI);
        const point = [lon, lat];
        
        if (isPointInLand(point)) {
            const projected = globeProjection(point);
            if (projected) {
                const dx = projected[0] - size / 2;
                const dy = projected[1] - size / 2;
                if (dx * dx + dy * dy < Math.pow(size / 2 - 15, 2)) {
                    return point;
                }
            }
        }
    }
    
    return [0, 0]; // Default to center
}

function isPointInLand(point) {
    // Use d3.geoContains for reliable point-in-polygon test
    for (const feature of landFeatures) {
        if (d3.geoContains(feature, point)) {
            return true;
        }
    }
    return false;
}

function spawnDeathPulse() {
    const [lon, lat] = randomVisibleLandLatLon();
    const coords = [lon, lat];
    const initialProjected = globeProjection(coords);
    
    if (!initialProjected) return;
    
    const pulseId = Date.now() + Math.random();
    
    activePulses.push({
        id: pulseId,
        coords: coords,
        createdAt: Date.now(),
        duration: 1200
    });
    
    // Pulse colors with good contrast
    const colors = ["#ff5252", "#ff6b6b", "#ff3838", "#ff2525"];
    const pulseColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Create pulse with multiple circles for better effect
    const pulseGroup = pulseLayer.append("g")
        .attr("class", "pulse-group")
        .attr("data-id", pulseId.toString())
        .attr("transform", `translate(${initialProjected[0]}, ${initialProjected[1]})`);
    
    // Inner pulse (bright)
    pulseGroup.append("circle")
        .attr("class", "pulse-inner")
        .attr("r", 2)
        .attr("fill", pulseColor)
        .attr("opacity", 1)
        .style("filter", "url(#pulse-glow)");
    
    // Outer pulse (glow)
    pulseGroup.append("circle")
        .attr("class", "pulse-outer")
        .attr("r", 4)
        .attr("fill", pulseColor)
        .attr("opacity", 0.3)
        .style("filter", "url(#pulse-blur)");
    
    // Add pulse filters if not present
    const svg = d3.select("svg");
    if (!svg.select("#pulse-glow").size()) {
        const defs = svg.select("defs");
        
        // Pulse glow filter
        const glowFilter = defs.append("filter")
            .attr("id", "pulse-glow")
            .attr("x", "-200%")
            .attr("y", "-200%")
            .attr("width", "500%")
            .attr("height", "500%");
        
        glowFilter.append("feGaussianBlur")
            .attr("stdDeviation", "2")
            .attr("result", "blur");
        
        const feMerge = glowFilter.append("feMerge");
        feMerge.append("feMergeNode")
            .attr("in", "blur");
        feMerge.append("feMergeNode")
            .attr("in", "SourceGraphic");
        
        // Pulse blur filter
        defs.append("filter")
            .attr("id", "pulse-blur")
            .attr("x", "-200%")
            .attr("y", "-200%")
            .attr("width", "500%")
            .attr("height", "500%")
            .append("feGaussianBlur")
            .attr("stdDeviation", "3");
    }
    
    // Animate pulses
    pulseGroup.selectAll("circle")
        .transition()
        .duration(1200)
        .ease(d3.easeCubicOut)
        .attr("r", function() {
            return d3.select(this).attr("class") === "pulse-inner" ? 15 : 25;
        })
        .attr("opacity", 0)
        .on("end", function() {
            const id = pulseGroup.attr("data-id");
            activePulses = activePulses.filter(p => p.id.toString() !== id);
            pulseGroup.remove();
        });
}

function createFallbackGlobe(svg) {
    const g = svg.append("g");
    
    // Create a simple globe with continent outlines
    const projection = d3.geoOrthographic()
        .scale(size / 2 - 10)
        .translate([size / 2, size / 2])
        .clipAngle(90);
    
    const path = d3.geoPath().projection(projection);
    
    // Add continent circles
    const continents = [
        {name: "Africa", center: [20, 0], radius: 25, color: "#4a6b3f"},
        {name: "Americas", center: [-90, 20], radius: 40, color: "#3a5a2f"},
        {name: "Asia", center: [100, 45], radius: 50, color: "#4a6b3f"},
        {name: "Europe", center: [20, 50], radius: 20, color: "#3a5a2f"},
        {name: "Australia", center: [135, -25], radius: 18, color: "#4a6b3f"}
    ];
    
    continents.forEach(continent => {
        g.append("circle")
            .attr("cx", projection(continent.center)[0])
            .attr("cy", projection(continent.center)[1])
            .attr("r", continent.radius)
            .attr("fill", continent.color)
            .attr("stroke", "#2a3a2a")
            .attr("stroke-width", 1);
    });
    
    // Add grid lines
    for (let i = -150; i <= 150; i += 30) {
        if (i === 0) continue; // Skip prime meridian for cleaner look
        
        g.append("path")
            .attr("d", path({type: "LineString", coordinates: [[i, -85], [i, 85]]}))
            .attr("stroke", "#3a5a8a")
            .attr("stroke-width", 0.3)
            .attr("fill", "none");
    }
    
    for (let i = -60; i <= 60; i += 30) {
        g.append("path")
            .attr("d", path({type: "LineString", coordinates: [[-180, i], [180, i]]}))
            .attr("stroke", "#3a5a8a")
            .attr("stroke-width", 0.3)
            .attr("fill", "none");
    }
}

// Cleanup old pulses periodically
setInterval(() => {
    const now = Date.now();
    const maxAge = 1500; // 1.5 seconds
    
    activePulses.forEach(pulse => {
        if (now - pulse.createdAt > maxAge) {
            const pulseElement = pulseLayer.select(`[data-id="${pulse.id}"]`);
            if (!pulseElement.empty()) {
                pulseElement.remove();
            }
        }
    });
    
    activePulses = activePulses.filter(pulse => now - pulse.createdAt <= maxAge);
}, 2000);

// Initialize globe
createMiniGlobe("#rotating-globe");

// Handle window resize
window.addEventListener('resize', debounce(() => {
    const container = d3.select("#rotating-globe");
    if (!container.empty()) {
        const newSize = Math.min(container.node().offsetWidth, 400);
        size = newSize;
        container.select("svg").remove();
        createMiniGlobe("#rotating-globe");
    }
}, 250));

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}