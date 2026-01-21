const CONFIG = {
    width: 960,
    height: 500,
    minZoom: 0.9,
    maxZoom: 8,
    defaultYear: 1990,
    animationSpeed: 1000
};

let width, height, svg, projection, path, colorScale, zoom;
let worldGeo, mortalityData, countries, tooltip;
let currentYear = CONFIG.defaultYear;
let currentCause = null;
let currentMetric = 'absolute';
let animationInterval = null;
let transform = d3.zoomIdentity;
let selectedCountry = null;
let lastRenderTime = 0;
let throttleDelay = 100;
let mapUpdateTimeout = null;


// Helper functions
function getCountryCode(d) {
    return d.properties?.iso_a3 || "";
}

function getAvailableCauses(data) {
    const causes = new Set();
    data.forEach(d => {
        if (d.CauseOfDeath) causes.add(d.CauseOfDeath);
    });
    
    // Convert to array and sort
    const causeArray = Array.from(causes).sort();
    
    // Add the special options at the beginning
    return [
        { value: 'all_causes', label: 'All Causes (Total)' },
        { value: 'specified_causes', label: 'All Specified Causes' },
        { value: 'unspecified_causes', label: 'Non-Specific Causes' },
        ...causeArray.map(cause => ({ value: cause, label: cause }))
    ];
}

function getCurrentCause() {
    const value = d3.select("#cause").property("value");
    if (value) return value;
    
    // Default to first cause
    const causes = getAvailableCauses(mortalityData);
    return causes[0]?.value || 'all_causes';
}

// Session storage helpers
function saveSessionState() {
    try {
        sessionStorage.setItem('mortalityMapState', JSON.stringify({
            year: currentYear,
            cause: currentCause,
            metric: currentMetric
        }));
    } catch (e) {
        console.warn("Could not save to session storage:", e);
    }
}

function loadSessionState() {
    try {
        const saved = sessionStorage.getItem('mortalityMapState');
        if (saved) {
            const state = JSON.parse(saved);
            if (state.year) currentYear = Math.min(Math.max(state.year, 1990), 2019);
            if (state.cause) currentCause = state.cause;
            if (state.metric) currentMetric = state.metric;
        }
    } catch (e) {
        console.warn("Could not load from session storage:", e);
    }
}

// Enhanced country data matching
function getCountryData(iso, countryName, year) {
    // Primary match: ISO3
    let data = mortalityData.filter(d => d.ISO3 === iso && d.Year === year);
    if (data.length) return data;

    // Secondary match: country name with exact match
    data = mortalityData.filter(d => d.Country === countryName && d.Year === year);
    if (data.length) return data;

    // Tertiary match: country name with partial match
    if (countryName) {
        data = mortalityData.filter(d => {
            const dataCountry = d.Country?.toLowerCase() || '';
            const targetCountry = countryName?.toLowerCase() || '';
            return dataCountry.includes(targetCountry) || targetCountry.includes(dataCountry);
        }).filter(d => d.Year === year);
        if (data.length) return data;
    }

    return [];
}

// Caching for better performance
const countryYearCache = {};
function getCountryDataCached(iso, countryName, year) {
    const key = `${iso}_${year}`;
    if (countryYearCache[key]) return countryYearCache[key];
    
    const data = getCountryData(iso, countryName, year);
    countryYearCache[key] = data;
    return data;
}

function getCountryYearData(iso, year) {
    return mortalityData.filter(d => d.ISO3 === iso && +d.Year === +year);
}

function getCountryAllYears(iso) {
    return mortalityData.filter(d => d.ISO3 === iso);
}

function getTotalDeathsOverTime(iso) {
    const data = mortalityData.filter(d => d.ISO3 === iso);
    if (!data.length) return [];
    
    const yearlyTotals = {};
    data.forEach(d => {
        const year = +d.Year;
        if (!yearlyTotals[year]) {
            yearlyTotals[year] = {
                totalDeaths: 0,
                population: 0
            };
        }
        yearlyTotals[year].totalDeaths = Math.max(yearlyTotals[year].totalDeaths, +d.TotalDeaths || 0);
        yearlyTotals[year].population = Math.max(yearlyTotals[year].population, +d.Population || 0);
    });
    
    return Object.keys(yearlyTotals)
        .map(year => ({
            year: +year,
            totalDeaths: yearlyTotals[year].totalDeaths,
            population: yearlyTotals[year].population
        }))
        .sort((a, b) => a.year - b.year);
}

async function init() {
    console.log("Initializing dashboard...");
    
    // Load saved state from session storage
    loadSessionState();
    
    width = CONFIG.width;
    height = CONFIG.height;
    
    svg = d3.select("#map")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", [0, 0, width, height])
        .attr("style", "max-width: 100%; height: auto;");
    
    const g = svg.append("g");
    
    projection = d3.geoMercator()
        .scale(140)
        .translate([width / 2, height / 1.5]);
    
    path = d3.geoPath().projection(projection);
    
    setupZoom();
    
    tooltip = d3.select("#tooltip");
    
    try {
        const [geoData, deathData] = await Promise.all([
            d3.json("data/world-110m.json"),
            d3.json("data/dataset.json")
        ]);
        
        console.log("Data loaded:", {
            countries: geoData.features?.length,
            mortalityRecords: deathData.length
        });
        
        worldGeo = geoData;
        
        // Convert string numbers to actual numbers and calculate DeathsPer100k
        mortalityData = deathData.map(d => {
            const deaths = +d.DeathsFromCause || 0;
            const population = +d.Population || 1;
            const deathsPer100k = (deaths / population) * 100000;
            return {
                ...d,
                Year: +d.Year,
                DeathsFromCause: deaths,
                TotalDeaths: +d.TotalDeaths || 0,
                Population: population,
                DeathsPer100k: deathsPer100k
            };
        });
        
        console.log("Sample data after conversion:", mortalityData[0]);
        console.log("Global max DeathsFromCause:", d3.max(mortalityData, d => d.DeathsFromCause));
        console.log("Global max DeathsPer100k:", d3.max(mortalityData, d => d.DeathsPer100k));
        
        initControls();
        drawMap(g);
        createLegend();
        
        updateYearDisplay(currentYear);
        updateDataCount();
        
        // Initialize map with saved state
        updateMap(currentYear, currentCause);
    } catch(error) {
        console.error("Error loading data:", error);
        showError("Failed to load data. Please check the console.");
    }
}

function initControls() {
    const yearSlider = d3.select("#year-range");
    const yearValue = d3.select("#year-value");
    
    yearSlider
        .attr("min", 1990)
        .attr("max", 2019)
        .attr("value", currentYear);
    
    yearValue.text(currentYear);
    
    // Throttled year slider handler
    yearSlider.on("input", function() {
        const year = +this.value;
        yearValue.text(year);
        updateYearDisplay(year);
        
        // Throttle updates to prevent lag
        if (mapUpdateTimeout) clearTimeout(mapUpdateTimeout);
        mapUpdateTimeout = setTimeout(() => {
            updateMap(year, getCurrentCause());
            saveSessionState();
        }, throttleDelay);
    });
    
    // Update the cause dropdown initialization in initControls():
    const causes = getAvailableCauses(mortalityData);
    const causeSelect = d3.select("#cause");

    // Clear existing options first
    causeSelect.html("");

    // Add options
    causeSelect.selectAll("option")
        .data(causes)
        .enter()
        .append("option")
        .attr("value", d => d.value)
        .text(d => d.label);

    // Set to saved cause or first cause
    if (currentCause && causes.some(c => c.value === currentCause)) {
        causeSelect.property("value", currentCause);
    } else {
        currentCause = causes[0].value;
    }
    
    causeSelect.on("change", function() {
        currentCause = this.value;
        updateMap(currentYear, currentCause);
        saveSessionState();
    });
    
    // Set metric to saved value
    const metricSelect = d3.select("#metric");
    if (currentMetric) {
        metricSelect.property("value", currentMetric);
    }
    
    // Add metric indicator (only once, not in the change handler)
    if (!d3.select("#metric-indicator").node()) {
        d3.select("#controls").append("div")
            .attr("id", "metric-indicator")
            .style("font-size", "12px")
            .style("color", "#888")
            .style("margin-top", "5px")
            .text(`Showing: ${currentMetric === 'absolute' ? 'absolute deaths' : 'deaths per 100k'}`);
    }
    
    // FIXED: Correctly handle metric change to update the map
    metricSelect.on("change", function() {
        currentMetric = this.value;
        updateMap(currentYear, currentCause);
        saveSessionState();
        
        // Update metric indicator
        d3.select("#metric-indicator")
            .text(`Showing: ${currentMetric === 'absolute' ? 'absolute deaths' : 'deaths per 100k'}`);
    });

    d3.select("#play-btn").on("click", startAnimation);
    d3.select("#pause-btn").on("click", stopAnimation);
    d3.select("#reset-zoom").on("click", resetZoom);
    d3.select("#country-panel .close-btn").on("click", closeCountryPanel);
}

function drawMap(g) {
    countries = g.append("g")
        .selectAll("path")
        .data(worldGeo.features)
        .enter()
        .append("path")
        .attr("d", path)
        .attr("fill", "#333")
        .attr("stroke", "#555")
        .attr("stroke-width", 0.5)
        .attr("class", "country")
        .attr("data-iso", d => d.properties?.iso_a3 || "")
        .attr("data-name", d => d.properties?.name || "Unknown")
        .attr("data-adm", d => d.properties?.adm0_a3 || "")
        .on("mouseover", handleMouseOver)
        .on("mouseout", handleMouseOut)
        .on("mousemove", handleMouseMove)
        .on("click", handleCountryClick);
}

function handleCountryClick(event, d) {
    const iso = getCountryCode(d);
    const name = d.properties?.name || "Unknown";

    // Store selected country
    selectedCountry = { iso, name };

    // Highlight selected country
    countries.attr("stroke", "#555").attr("stroke-width", 0.5);
    d3.select(this).attr("stroke", "#ffcc00").attr("stroke-width", 3);

    openCountryPanel(name, iso, currentYear);
}

function openCountryPanel(name, iso, year) {
    const panel = d3.select("#country-panel");
    panel.classed("hidden", false);
    
    d3.select("#country-name").text(name);
    d3.select("#country-iso").text(iso);
    
    populateYearDropdown(iso, year);
    updateCountryPanel(iso, name, year);
}

function closeCountryPanel() {
    d3.select("#country-panel").classed("hidden", true);
    
    // Reset the selected country styling
    if (selectedCountry) {
        countries.filter(d => getCountryCode(d) === selectedCountry.iso)
            .attr("stroke", "#555")
            .attr("stroke-width", 0.5);
        selectedCountry = null;
    }
}

function populateYearDropdown(iso, selectedYear) {
    const years = [...new Set(
        mortalityData
            .filter(d => d.ISO3 === iso)
            .map(d => +d.Year)
    )].sort();
    
    const select = d3.select("#country-year");
    select.selectAll("option").remove();
    
    select.selectAll("option")
        .data(years)
        .enter()
        .append("option")
        .attr("value", d => d)
        .property("selected", d => d === selectedYear)
        .text(d => d);
    
    select.on("change", function() {
        updateCountryPanel(iso, null, this.value);
    });
}

function updateCountryPanel(iso, name, year) {
    const data = getCountryYearData(iso, year);
    if(!data.length) {
        d3.select("#country-summary").html("<p>No data available for this selection.</p>");
        d3.select("#cause-bar-chart").selectAll("*").remove();
        d3.select("#country-trend-chart").selectAll("*").remove();
        d3.select("#country-trend-summary").html("");
        return;
    }
    
    // Draw the charts
    drawCauseBarChartFull(data);
    drawCountryTrend(iso);
    
    // Build narrative summary
    if(name) {
        d3.select("#country-summary").html(buildCountrySummary(name, iso, year, data));
    }
}

function handleMouseMove(event, d) {
    const iso = getCountryCode(d);
    const name = d.properties?.name || "";
    
    const data = getCountryDataCached(iso, name, currentYear);
    if (!data.length) {
        tooltip.style("display", "none");
        return;
    }
    
    const totalDeaths = d3.max(data, d => d.TotalDeaths || 0);
    const population = d3.max(data, d => d.Population || 0);
    const specifiedDeaths = d3.sum(data, d => d.DeathsFromCause || 0);
    const unspecifiedDeaths = Math.max(totalDeaths - specifiedDeaths, 0);
    
    let value;
    let label;
    
    // FIXED: Changed 'per100k' to 'relative' to match HTML
    if (currentCause === 'all_causes') {
        value = currentMetric === 'relative' 
            ? (population ? (totalDeaths / population) * 100000 : 0)
            : totalDeaths;
        label = "All causes (total)";
    } else if (currentCause === 'specified_causes') {
        value = currentMetric === 'relative'
            ? d3.sum(data, d => d.DeathsPer100k || 0)
            : specifiedDeaths;
        label = "All specified causes (30 causes)";
    } else if (currentCause === 'unspecified_causes') {
        const totalPer100k = population ? (totalDeaths / population) * 100000 : 0;
        const specifiedPer100k = d3.sum(data, d => d.DeathsPer100k || 0);
        const unspecifiedPer100k = Math.max(totalPer100k - specifiedPer100k, 0);
        
        value = currentMetric === 'relative'
            ? unspecifiedPer100k
            : unspecifiedDeaths;
        label = "Non-specific causes";
    } else {
        // Specific cause
        const causeData = data.filter(d => d.CauseOfDeath === currentCause);
        const rawDeaths = d3.sum(causeData, d => d.DeathsFromCause);
        const rawPer100k = d3.sum(causeData, d => d.DeathsPer100k);
        
        value = currentMetric === 'relative' ? rawPer100k : rawDeaths;
        label = `Cause: ${currentCause}`;
    }
    
    if (value === null || value === undefined || isNaN(value)) {
        tooltip.style("display", "none");
        return;
    }
    
    tooltip
        .style("display", "block")
        .style("left", `${event.pageX + 12}px`)
        .style("top", `${event.pageY - 12}px`)
        .html(`
            <div class="tooltip-header">${name}</div>
            <div class="tooltip-year">Year: ${currentYear}</div>
            <div class="tooltip-metric">${label}</div>
            <div class="tooltip-value">
                ${currentMetric === 'relative' 
                    ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
                    : Math.round(value).toLocaleString()}
                ${currentMetric === 'relative' ? ' per 100k' : ''}
            </div>
        `);
}

function updateMap(year, cause) {
    currentYear = year;
    currentCause = cause || currentCause;

    d3.select("#map-title").text(`Global Mortality Map (${year})`);

    const yearData = mortalityData.filter(d => d.Year === year);
    const valuesByCountry = {};

    // Aggregate per country
    yearData.forEach(d => {
        const iso = d.ISO3;
        if (!iso) return;

        if (!valuesByCountry[iso]) {
            valuesByCountry[iso] = {
                totalDeaths: 0,
                population: 0,
                byCause: {},
                deathsPer100kByCause: {}  // Store per 100k values too
            };
        }

        const c = valuesByCountry[iso];
        c.totalDeaths = d.TotalDeaths || 0;
        c.population = d.Population || 0;

        if (d.CauseOfDeath) {
            c.byCause[d.CauseOfDeath] = 
                (c.byCause[d.CauseOfDeath] || 0) + (d.DeathsFromCause || 0);
            // Store the precomputed per 100k value
            c.deathsPer100kByCause[d.CauseOfDeath] = 
                (c.deathsPer100kByCause[d.CauseOfDeath] || 0) + (d.DeathsPer100k || 0);
        }
    });

    // Compute per-country metric values
    const computedValues = {};
    let globalMax = 0;

    Object.entries(valuesByCountry).forEach(([iso, c]) => {
        const specifiedTotal = Object.values(c.byCause).reduce((a, b) => a + b, 0);
        const unspecified = Math.max(c.totalDeaths - specifiedTotal, 0);
        
        // FIXED: Changed 'per100k' to 'relative' to match HTML
        let value;
        
        if (currentMetric === 'relative') {
            if (currentCause === 'all_causes') {
                // Total deaths per 100k
                value = c.population > 0 ? (c.totalDeaths / c.population) * 100000 : 0;
            } else if (currentCause === 'specified_causes') {
                // Sum of all specific causes per 100k
                const specifiedTotalPer100k = Object.values(c.deathsPer100kByCause).reduce((a, b) => a + b, 0);
                value = specifiedTotalPer100k;
            } else if (currentCause === 'unspecified_causes') {
                // Unspecified causes per 100k
                const specifiedTotalPer100k = Object.values(c.deathsPer100kByCause).reduce((a, b) => a + b, 0);
                const totalPer100k = c.population > 0 ? (c.totalDeaths / c.population) * 100000 : 0;
                value = Math.max(totalPer100k - specifiedTotalPer100k, 0);
            } else {
                // Specific cause per 100k - use the precomputed value
                value = c.deathsPer100kByCause[currentCause] || 0;
            }
        } else {
            // Absolute numbers
            if (currentCause === 'all_causes') {
                value = c.totalDeaths;
            } else if (currentCause === 'specified_causes') {
                value = specifiedTotal;
            } else if (currentCause === 'unspecified_causes') {
                value = unspecified;
            } else {
                value = c.byCause[currentCause] || 0;
            }
        }

        computedValues[iso] = value;
        if (value > globalMax) globalMax = value;
    });

    // Guard against empty or zero-only data
    if (!globalMax || !isFinite(globalMax)) {
        globalMax = 1;
    }

    // Build scale
    colorScale = d3.scaleSequential()
        .domain([0, globalMax])
        .clamp(true)
        .interpolator(t => d3.interpolateRdBu(1 - t));

    // Paint map
    countries.attr("fill", d => {
        const iso = getCountryCode(d);
        const v = computedValues[iso] || 0;
        return v > 0 ? colorScale(v) : "#333";
    });

    // Update legend
    updateLegend(0, globalMax, currentMetric);
    updateDataCount(Object.values(computedValues).filter(v => v > 0).length);

    if (selectedCountry) {
        updateCountryPanel(selectedCountry.iso, selectedCountry.name, currentYear);
    }
}

function createLegend() {
    const legend = d3.select("#color-legend");
    legend.html(`
        <div class="legend-title" id="legend-title">Deaths Scale</div>
        <div class="legend-gradient"></div>
        <div class="legend-labels">
            <span class="legend-min-label">Low</span>
            <span class="legend-max-label">High</span>
        </div>
        <div class="legend-values">
            <span class="legend-min-value">0</span>
            <span class="legend-max-value">0</span>
        </div>
    `);
    
    // Apply the gradient
    d3.select(".legend-gradient")
        .style("width", "200px")
        .style("height", "15px")
        .style("border-radius", "3px")
        .style("margin", "5px 0")
        .style("background", "linear-gradient(to right, #2166ac, #f7f7f7, #b2182b)");
    
    d3.select(".legend-labels")
        .style("display", "flex")
        .style("justify-content", "space-between")
        .style("font-size", "0.8em")
        .style("color", "#aaa");
        
    d3.select(".legend-values")
        .style("display", "flex")
        .style("justify-content", "space-between")
        .style("font-size", "0.7em")
        .style("color", "#888");
}

function updateLegend(minValue, maxValue, metric) {
    const formatValue = value => {
        if (!isFinite(value)) return '0';

        if (metric === 'absolute') {
            if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
            if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
            return value.toFixed(0);
        }

        return value.toFixed(1);
    };

    d3.select(".legend-min-value").text(formatValue(minValue));
    d3.select(".legend-max-value").text(formatValue(maxValue));

    // FIXED: Changed 'per100k' to 'relative' to match HTML
    d3.select("#legend-title").text(
        metric === 'relative' ? 'Deaths per 100k' : 'Number of deaths'
    );
}

function zoomed(event) {
    if(event.sourceEvent) {
        event.sourceEvent.preventDefault();
    }
    
    transform = event.transform;
    svg.selectAll("g")
        .attr("transform", transform)
        .attr("stroke-width", 0.5 / transform.k);
}

function resetZoom() {
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
}

function setupZoom() {
    zoom = d3.zoom()
        .scaleExtent([CONFIG.minZoom, CONFIG.maxZoom])
        .on("start", function(event) {
            if(event.sourceEvent) {
                event.sourceEvent.preventDefault();
            }
        })
        .on("zoom", zoomed)
        .on("end", function(event) {
            if(event.sourceEvent) {
                event.sourceEvent.preventDefault();
            }
        });
    
    svg.call(zoom);
    
    svg.on("wheel.zoom-control", function(event) {
        event.preventDefault();
        
        const currentScale = transform.k;
        const delta = event.deltaY;
        
        if(currentScale >= CONFIG.maxZoom && delta < 0) {
            return;
        }
        
        if(currentScale <= CONFIG.minZoom && delta > 0) {
            return;
        }
        
        zoom.wheel(event);
    });
    
    svg.on("touchmove.zoom-control", function(event) {
        event.preventDefault();
    });
    
    svg.on("DOMMouseScroll.zoom-control", function(event) {
        event.preventDefault();
    });
}

function startAnimation() {
    stopAnimation();
    
    let year = currentYear;
    const yearSlider = d3.select("#year-range");
    const yearValue = d3.select("#year-value");
    
    animationInterval = setInterval(() => {
        year++;
        if(year > 2019) {
            year = 1990;
        }
        
        yearSlider.property("value", year);
        yearValue.text(year);
        updateYearDisplay(year);
        updateMap(year, currentCause);
        saveSessionState();
    }, CONFIG.animationSpeed);
}

function stopAnimation() {
    if(animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

function handleMouseOver(event, d) {
    d3.select(this)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);
}

function handleMouseOut(event, d) {
    d3.select(this)
        .attr("stroke", "#555")
        .attr("stroke-width", 0.5);
    tooltip.style("display", "none");
}

function updateYearDisplay(year) {
    d3.select("#current-year").text(year);
    d3.select("#year-value").text(year);
}

function updateDataCount(count) {
    if (!count) {
        // Count countries with non-zero data for current selection
        const yearData = mortalityData.filter(d => d.Year === currentYear);
        
        let uniqueCountries;
        if (currentCause === 'all_causes' || currentCause === 'specified_causes' || currentCause === 'unspecified_causes') {
            // For aggregated categories, count all countries with any data
            uniqueCountries = new Set(
                yearData.map(d => d.ISO3).filter(Boolean)
            );
        } else {
            // For specific cause
            uniqueCountries = new Set(
                yearData
                    .filter(d => d.CauseOfDeath === currentCause && (d.DeathsFromCause || 0) > 0)
                    .map(d => d.ISO3)
                    .filter(Boolean)
            );
        }
        
        count = uniqueCountries.size;
    }
    
    d3.select("#data-count").text(count);
}

function showError(message) {
    svg.selectAll("*").remove();
    
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#e25555")
        .text("⚠️ " + message);
}

// Country panel helper functions
function buildCountrySummary(name, iso, year, data) {
    if(!Array.isArray(data) || !data.length) {
        return "<p>No data available for this selection.</p>";
    }

    const totalDeaths = d3.max(data, d => +d.TotalDeaths) || 0;
    const population = d3.max(data, d => +d.Population) || 1;
    const deathRate = (totalDeaths / population) * 100000;
    
    const absRank = getGlobalAbsoluteRank(iso, year);
    const rateRank = getGlobalRank(iso, year);
    
    const rankedCauses = rankCauses(data);
    const top = rankedCauses[0];
    const second = rankedCauses[1];
    const least = rankedCauses[rankedCauses.length - 1];
    
    const percent = getCausePercentage(top?.deaths || 0, totalDeaths);
    const percent2 = getCausePercentage(second?.deaths || 0, totalDeaths);

    let summary = `
        In <strong>${name}</strong>,
        <strong>${formatInt(totalDeaths)}</strong> deaths were recorded
        in <strong>${year}</strong>,
        corresponding to <strong>${formatRate(deathRate)}</strong> deaths
        per 100,000 people among its <strong>${formatInt(population)}</strong> inhabitants.
        <br>
        Globally, this corresponds to
        <strong>rank ${absRank.rank}</strong> in total deaths and
        <strong>rank ${rateRank.rank}</strong> in deaths per 100,000 people,
        out of <strong>${rateRank.total}</strong> countries with recorded data.
        <br>
    `;

    if(top) {
        summary += `
            <br>
            <strong>${top.cause}</strong> was the leading cause at ${percent.toFixed(1)}% contribution,
            responsible for <strong>${formatInt(top.deaths)}</strong> deaths.
        `;
    }

    if(second) {
        summary += `
            <br>
            The second leading cause was <strong>${second.cause}</strong> at ${percent2.toFixed(1)}% contribution,
            with <strong>${formatInt(second.deaths)}</strong> deaths.
        `;
    }

    if(least && least.cause !== top?.cause) {
        summary += `
            <br>
            At the other end of the spectrum,
            <strong>${least.cause}</strong> accounted for the fewest deaths,
            <strong>${formatInt(least.deaths)}</strong>.
        `;
    }

    return summary;
}

function getCausePercentage(causeDeaths, totalDeaths) {
    if (!totalDeaths) return 0;
    return (causeDeaths / totalDeaths) * 100;
}

function getGlobalAbsoluteRank(iso, year) {
    const yearData = mortalityData.filter(d => +d.Year === +year);
    const byCountry = d3.rollups(
        yearData,
        v => d3.max(v, d => +d.TotalDeaths),
        d => d.ISO3
    );
    
    const sorted = byCountry
        .filter(d => d[1] && !isNaN(d[1]))
        .sort((a, b) => b[1] - a[1]);
    
    const rank = sorted.findIndex(d => d[0] === iso) + 1;
    
    return {
        rank: rank || sorted.length,
        total: sorted.length
    };
}

function getGlobalRank(iso, year) {
    const yearData = mortalityData.filter(d => +d.Year === +year);
    const byCountry = d3.rollups(
        yearData,
        v => {
            const totalDeaths = d3.max(v, d => +d.TotalDeaths) || 0;
            const population = d3.max(v, d => +d.Population) || 1;
            return (totalDeaths / population) * 100000;
        },
        d => d.ISO3
    );
    
    const sorted = byCountry
        .filter(d => d[1] && !isNaN(d[1]))
        .sort((a, b) => b[1] - a[1]);
    
    const rank = sorted.findIndex(d => d[0] === iso) + 1;
    
    return {
        rank: rank || sorted.length,
        total: sorted.length
    };
}

function rankCauses(data) {
    return data
        .map(d => ({
            cause: d.CauseOfDeath,
            deaths: +d.DeathsFromCause
        }))
        .filter(d => d.deaths > 0)
        .sort((a, b) => b.deaths - a.deaths);
}

function generateInsightfulTrendNarrative(data) {
    /*
    if (!data || data.length < 2) return "Insufficient data for trend analysis.";

    const firstYear = data[0];
    const lastYear = data[data.length - 1];
    const change = lastYear.per100k - firstYear.per100k;
    const percentChange = (change / firstYear.per100k) * 100;

    let narrative = `From ${firstYear.year} to ${lastYear.year}, the death rate `;

    if (percentChange > 10) {
        narrative += `increased significantly by ${Math.abs(percentChange).toFixed(1)}%.`;
    } else if (percentChange < -10) {
        narrative += `decreased significantly by ${Math.abs(percentChange).toFixed(1)}%.`;
    } else {
        narrative += `remained relatively stable.`;
    }

    const peakYear = data.reduce((max, d) => d.per100k > max.per100k ? d : max, data[0]);
    const lowYear = data.reduce((min, d) => d.per100k < min.per100k ? d : min, data[0]);

    if (peakYear !== firstYear && peakYear !== lastYear) {
        narrative += ` The peak was in ${peakYear.year} with ${formatRate(peakYear.per100k)} deaths per 100k.`;
    }

    return narrative;*/

    return "";
}

function drawCauseBarChartFull(data) {
    if(!data || !data.length) {
        return;
    }
    
    const sorted = data
        .map(d => ({
            cause: d.CauseOfDeath,
            deaths: +d.DeathsFromCause,
            percent: (+d.DeathsFromCause / (+d.TotalDeaths || 1)) * 100
        }))
        .sort((a, b) => b.deaths - a.deaths);
    
    const totalDeaths = d3.sum(sorted, d => d.deaths);
    
    let cumulative = 0;
    let cutoffIndex = -1;
    sorted.forEach((d, i) => {
        cumulative += d.deaths;
        if(cutoffIndex === -1 && cumulative >= totalDeaths * 0.5) {
            cutoffIndex = i;
        }
    });
    
    const zeroCauses = sorted.filter(d => d.deaths === 0);
    
    const margin = { top: 20, right: 160, bottom: 40, left: 180 };
    const width = 500 - margin.left - margin.right;
    const barHeight = 20;
    const height = sorted.length * barHeight;
    
    const svg = d3.select("#cause-bar-chart");
    svg.selectAll("*").remove();
    svg.attr("width", width + margin.left + margin.right)
       .attr("height", height + margin.top + margin.bottom);
    
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    const positiveData = sorted.filter(d => d.deaths > 0);
    if(!positiveData.length) {
        return;
    }
    
    const minVal = d3.min(positiveData, d => d.deaths);
    const maxVal = d3.max(positiveData, d => d.deaths);
    
    const x = d3.scaleLog()
        .domain([Math.max(minVal, 1), maxVal])
        .range([0, width])
        .clamp(true);
    
    const y = d3.scaleBand()
        .domain(sorted.map(d => d.cause))
        .range([0, height])
        .padding(0.2);
    
    g.selectAll(".bar")
        .data(sorted.filter(d => d.deaths > 0))
        .enter()
        .append("rect")
        .attr("class", "bar")
        .attr("y", d => y(d.cause))
        .attr("height", y.bandwidth())
        .attr("x", 0)
        .attr("width", d => x(d.deaths))
        .attr("fill", "#4a90e2")
        .attr("opacity", 0.7);
    
    g.selectAll(".label")
        .data(sorted)
        .enter()
        .append("text")
        .attr("class", "label")
        .attr("x", d => d.deaths > 0 ? x(d.deaths) + 5 : 5)
        .attr("y", d => y(d.cause) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .text(d => d.deaths > 0 ? `${d.deaths.toLocaleString()} (${d.percent.toFixed(1)}%)` : "0")
        .style("font-size", "0.8em")
        .style("fill", "#000000");
    
    g.append("g")
        .call(d3.axisLeft(y))
        .selectAll("text")
        .style("font-size", "0.85em");
    
    g.append("g")
        .attr("transform", `translate(0, ${height})`)
        .call(d3.axisBottom(x).ticks(4, "~s"));
    
    if(cutoffIndex >= 0 && cutoffIndex < sorted.length - 1) {
        const sepY = (y(sorted[cutoffIndex].cause) + y(sorted[cutoffIndex + 1].cause)) / 2 + 10;
        
        g.append("line")
            .attr("x1", 0)
            .attr("x2", width + 100)
            .attr("y1", sepY)
            .attr("y2", sepY)
            .attr("stroke", "#e25555")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "4 4");
        
        g.append("text")
            .attr("x", width + 105)
            .attr("y", sepY)
            .attr("dy", "0.35em")
            .text("Top contributors")
            .style("fill", "#e25555")
            .style("font-size", "0.8em")
            .style("font-weight", "bold");
    }
    
    if(zeroCauses.length > 0) {
        const firstZeroY = y(zeroCauses[0].cause);
        const lastPositiveY = y(positiveData[positiveData.length - 1].cause);
        const sepY = (lastPositiveY + firstZeroY) / 2;
        
        g.append("line")
            .attr("x1", 0)
            .attr("x2", width + 100)
            .attr("y1", sepY + 8)
            .attr("y2", sepY + 8)
            .attr("stroke", "#888")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "2 2");
        
        g.append("text")
            .attr("x", width + 105)
            .attr("y", sepY + 8)
            .attr("dy", "0.35em")
            .text("No data registered")
            .style("fill", "#888")
            .style("font-size", "0.8em")
            .style("font-weight", "bold");
    }
}

function drawCountryTrend(iso) {
    const data = getTotalDeathsOverTime(iso);
    if(!data || !data.length) {
        return;
    }
    
    const dataWithRate = data.map(d => ({
        year: d.year,
        totalDeaths: d.totalDeaths,
        per100k: (d.totalDeaths / d.population) * 100000
    }));
    
    const narrative = generateInsightfulTrendNarrative(dataWithRate);
    d3.select("#country-trend-summary").html(`<p>${narrative}</p>`);
    
    const margin = { top: 20, right: 60, bottom: 30, left: 60 };
    const width = 420 - margin.left - margin.right;
    const height = 180 - margin.top - margin.bottom;
    
    const svg = d3.select("#country-trend-chart");
    svg.selectAll("*").remove();
    svg.attr("width", width + margin.left + margin.right)
       .attr("height", height + margin.top + margin.bottom);
    
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    const x = d3.scaleLinear()
        .domain(d3.extent(dataWithRate, d => d.year))
        .range([0, width]);
    
    const yLeft = d3.scaleLinear()
        .domain([0, d3.max(dataWithRate, d => d.totalDeaths)])
        .nice()
        .range([height, 0]);
    
    const yRight = d3.scaleLinear()
        .domain([0, d3.max(dataWithRate, d => d.per100k)])
        .nice()
        .range([height, 0]);
    
    const area = d3.area()
        .x(d => x(d.year))
        .y0(height)
        .y1(d => yLeft(d.totalDeaths))
        .curve(d3.curveMonotoneX);
    
    g.append("path")
        .datum(dataWithRate)
        .attr("fill", "#4a90e2")
        .attr("opacity", 0.6)
        .attr("d", area);
    
    const line = d3.line()
        .x(d => x(d.year))
        .y(d => yRight(d.per100k))
        .curve(d3.curveMonotoneX);
    
    g.append("path")
        .datum(dataWithRate)
        .attr("stroke", "#e25555")
        .attr("stroke-width", 2)
        .attr("fill", "none")
        .attr("d", line);
    
    g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("d")));
    
    g.append("g")
        .call(d3.axisLeft(yLeft).ticks(4).tickFormat(formatInt))
        .append("text")
        .attr("fill", "#000")
        .attr("x", 0)
        .attr("y", -10)
        .text("Total deaths");
    
    g.append("g")
        .attr("transform", `translate(${width},0)`)
        .call(d3.axisRight(yRight).ticks(4).tickFormat(formatRate))
        .append("text")
        .attr("fill", "#e25555")
        .attr("x", margin.right - 5)
        .attr("y", -10)
        .attr("text-anchor", "end")
        .text("Deaths per 100k");
}

document.addEventListener('DOMContentLoaded', init);

window.dashboard = {
    getData: () => ({ worldGeo, mortalityData }),
    updateMap,
    startAnimation,
    stopAnimation,
    resetZoom,
    openCountryPanel,
    closeCountryPanel
};