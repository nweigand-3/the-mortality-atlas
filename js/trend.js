// Main script
    document.addEventListener("DOMContentLoaded", () => {
        /* =========================
           CONFIG
        ========================= */
        const MARGIN = { top: 40, right: 40, bottom: 60, left: 80 };
        const WIDTH = 1200 - MARGIN.left - MARGIN.right;
        const HEIGHT = 500 - MARGIN.top - MARGIN.bottom;

        // Create SVG first
        const svg = d3.select("#trend-chart")
            .attr("width", WIDTH + MARGIN.left + MARGIN.right)
            .attr("height", HEIGHT + MARGIN.top + MARGIN.bottom);

        const g = svg.append("g")
            .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

        const container = document.querySelector(".chart-container");

        /* =========================
           SCALES & AXES
        ========================= */
        let x = d3.scaleLinear().range([0, WIDTH]);
        let y = d3.scaleLinear().range([HEIGHT, 0]);

        const xAxis = g.append("g")
            .attr("transform", `translate(0,${HEIGHT})`);

        const yAxis = g.append("g");

        // Add axis labels
        g.append("text")
            .attr("transform", `translate(${WIDTH / 2}, ${HEIGHT + 40})`)
            .style("text-anchor", "middle")
            .style("font-size", "14px")
            .style("fill", "#555")
            .text("Year");

        g.append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", -40)
            .attr("x", -HEIGHT / 2)
            .attr("dy", "1em")
            .style("text-anchor", "middle")
            .style("font-size", "14px")
            .style("fill", "#555")
            .text("Deaths");

        /* =========================
           PATHS
        ========================= */
        const line = d3.line()
            .x(d => x(d.year))
            .y(d => y(d.value))
            .curve(d3.curveMonotoneX);

        const area = d3.area()
            .x(d => x(d.year))
            .y0(HEIGHT)
            .y1(d => y(d.value))
            .curve(d3.curveMonotoneX);

        const seriesGroup = g.append("g").attr("class", "series-group");

        /* =========================
           TOOLTIP & INTERACTION
        ========================= */
        const tooltip = d3.select("#trend-tooltip");

        const focus = g.append("circle")
            .attr("r", 5)
            .attr("fill", "#e25555")
            .style("opacity", 0);

        /* =========================
           DATA
        ========================= */
        let raw = [];
        let causes = [];
        let selectedCauses = new Set(['all']); // Start with "All Causes" selected

        /* =========================
           LOAD DATA
        ========================= */
        d3.json("data/dataset.json").then(data => {
            if (!data || data.length === 0) {
                console.error("No data loaded");
                showErrorMessage("No data found in dataset.json");
                return;
            }

            raw = data.map(d => {
                const year = +d.Year;
                const deaths = +d.DeathsFromCause || 0;
                const population = +d.Population || 1;
                
                return {
                    year: year,
                    cause: d.CauseOfDeath,
                    deaths: deaths,
                    population: population,
                    per100k: (deaths / population) * 100000,
                    iso3: d.ISO3,
                    country: d.Country
                };
            });

            causes = [...new Set(raw.map(d => d.cause))].sort();

            initControls();
            update();

        }).catch(error => {
            console.error("Error loading data:", error);
            showErrorMessage(`Error loading data: ${error.message}`);
        });

        function showErrorMessage(message) {
            d3.select("#trend-insights").html(`
                <p>${message}</p>
                <p>Please check if the file exists at: data/dataset.json</p>
            `);
        }

        /* =========================
           INITIALIZE CONTROLS WITH TOGGLE BUTTONS
        ========================= */
        function initControls() {
            const years = [...new Set(raw.map(d => d.year))].sort((a, b) => a - b);
            if (years.length === 0) return;

            const minYear = years[0];
            const maxYear = years[years.length - 1];

            const startSlider = document.getElementById("time-start");
            const endSlider = document.getElementById("time-end");
            const timeValue = document.getElementById("time-value");

            startSlider.min = minYear;
            startSlider.max = maxYear;
            startSlider.value = minYear;

            endSlider.min = minYear;
            endSlider.max = maxYear;
            endSlider.value = maxYear;

            timeValue.textContent = `${minYear}-${maxYear}`;

            startSlider.addEventListener("input", updateSliders);
            endSlider.addEventListener("input", updateSliders);

            function updateSliders() {
                let start = parseInt(startSlider.value);
                let end = parseInt(endSlider.value);
                if (start > end) [start, end] = [end, start];
                startSlider.value = start;
                endSlider.value = end;
                timeValue.textContent = `${start}-${end}`;
                updateSliderTrack();
                update();
            }
            
            // Initialize slider track
            updateSliderTrack();

            // Set up other controls
            d3.select("#trend-metric").on("change", update);
            d3.select("#trend-scale").on("change", update);

            // Create toggle buttons
            createToggleButtons();
        }

        /* =========================
           CREATE TOGGLE BUTTONS
        ========================= */
        function createToggleButtons() {
            const container = document.getElementById('cause-toggles');
            
            // Clear container
            container.innerHTML = '';
            
            // Add "All Causes" button
            const allButton = document.createElement('button');
            allButton.className = 'toggle-btn all-causes active';
            allButton.textContent = 'All Causes';
            allButton.dataset.cause = 'all';
            allButton.onclick = () => toggleCause('all');
            container.appendChild(allButton);
            
            // Add individual cause buttons (limit to top 30 for performance)
            const topCauses = causes.slice(0, 30);
            topCauses.forEach(cause => {
                const button = document.createElement('button');
                button.className = 'toggle-btn';
                button.textContent = cause;
                button.dataset.cause = cause;
                button.onclick = () => toggleCause(cause);
                container.appendChild(button);
            });
            
            // Add "Clear All" button
            const clearButton = document.createElement('button');
            clearButton.className = 'toggle-btn';
            clearButton.textContent = 'Clear All';
            clearButton.onclick = clearAllSelections;
            container.appendChild(clearButton);
        }

        /* =========================
           TOGGLE BUTTON HANDLERS
        ========================= */
        function toggleCause(cause) {
            const isAll = cause === 'all';
            
            if (isAll) {
                // When clicking "All Causes", select only that
                selectedCauses.clear();
                selectedCauses.add('all');
                
                // Update button states
                document.querySelectorAll('.toggle-btn').forEach(btn => {
                    if (btn.dataset.cause === 'all') {
                        btn.classList.add('active');
                        btn.classList.add('all-causes');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            } else {
                // Remove "all" from selections when selecting specific causes
                selectedCauses.delete('all');
                
                // Toggle the specific cause
                if (selectedCauses.has(cause)) {
                    selectedCauses.delete(cause);
                } else {
                    selectedCauses.add(cause);
                }
                
                // Update button states
                document.querySelectorAll('.toggle-btn').forEach(btn => {
                    const btnCause = btn.dataset.cause;
                    if (!btnCause) return; // Skip clear button
                    
                    if (btnCause === 'all') {
                        btn.classList.remove('active');
                    } else {
                        btn.classList.toggle('active', selectedCauses.has(btnCause));
                    }
                });
                
                // If nothing selected, select "All Causes"
                if (selectedCauses.size === 0) {
                    toggleCause('all');
                    return;
                }
            }
            
            update();
        }

        function clearAllSelections() {
            selectedCauses.clear();
            selectedCauses.add('all');
            
            // Update button states
            document.querySelectorAll('.toggle-btn').forEach(btn => {
                if (btn.dataset.cause === 'all') {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
            
            update();
        }

        /* =========================
           UPDATE FUNCTION
        ========================= */
        function update() {
            const metric = d3.select("#trend-metric").property("value");
            const scaleType = d3.select("#trend-scale").property("value");

            let start = parseInt(document.getElementById("time-start").value);
            let end = parseInt(document.getElementById("time-end").value);
            if (start > end) [start, end] = [end, start];

            // Filter by time first
            let filtered = raw.filter(d => d.year >= start && d.year <= end);
            
            // Check if "All Causes" is selected
            const isAllSelected = selectedCauses.has('all');
            
            if (!isAllSelected && selectedCauses.size > 0) {
                // Filter by selected causes
                filtered = filtered.filter(d => selectedCauses.has(d.cause));
            }

            if (filtered.length === 0) {
                clearChart();
                return;
            }

            // Create series based on selection
            let series;
            
            if (isAllSelected) {
                // For "All Causes", aggregate everything
                const yearlyData = Array.from(
                    d3.rollup(
                        filtered,
                        v => d3.sum(v, d => metric === "absolute" ? d.deaths : d.per100k),
                        d => d.year
                    ),
                    ([year, value]) => ({ year: +year, value })
                ).sort((a, b) => a.year - b.year);
                
                series = [{
                    cause: "All Causes",
                    values: yearlyData
                }];
            } else {
                // For specific causes, create series for each
                series = Array.from(selectedCauses).map(cause => {
                    const causeData = filtered.filter(d => d.cause === cause);
                    const yearly = Array.from(
                        d3.rollup(
                            causeData,
                            v => d3.sum(v, d => metric === "absolute" ? d.deaths : d.per100k),
                            d => d.year
                        ),
                        ([year, value]) => ({ year: +year, value })
                    ).sort((a, b) => a.year - b.year);
                    
                    return { cause, values: yearly };
                });
            }

            // Flatten all points to get domain
            const allPoints = series.flatMap(s => s.values);

            if (allPoints.length === 0) {
                clearChart();
                return;
            }

            x.domain(d3.extent(allPoints, d => d.year));

            const maxValue = d3.max(allPoints, d => d.value);
            const minValue = d3.min(allPoints, d => d.value);

            // Set up y scale based on scale type
            if (scaleType === "log") {
                y = d3.scaleLog()
                    .domain([Math.max(0.1, minValue), maxValue])
                    .range([HEIGHT, 0])
                    .nice();
            } else {
                y = d3.scaleLinear()
                    .domain([0, maxValue])
                    .range([HEIGHT, 0])
                    .nice();
            }

            // Update axes
            xAxis.transition().duration(300)
                .call(d3.axisBottom(x).ticks(Math.min(10, allPoints.length)).tickFormat(d3.format("d")));
            yAxis.transition().duration(300)
                .call(scaleType === "log" ? 
                    d3.axisLeft(y).ticks(5, d3.format(".2s")) : 
                    d3.axisLeft(y).ticks(5).tickFormat(d3.format(".3s")));

            // DRAW LINES AND AREAS
            const seriesSelection = seriesGroup.selectAll(".series")
                .data(series, d => d.cause);

            const seriesEnter = seriesSelection.enter()
                .append("g")
                .attr("class", "series");

            seriesEnter.append("path")
                .attr("class", "area")
                .attr("opacity", 0.15);

            seriesEnter.append("path")
                .attr("class", "line")
                .attr("fill", "none")
                .attr("stroke-width", 3);

            const merged = seriesEnter.merge(seriesSelection);

            merged.select(".area")
                .attr("fill", d => color(d.cause))
                .transition().duration(300)
                .attr("d", d => area(d.values));

            merged.select(".line")
                .attr("stroke", d => color(d.cause))
                .transition().duration(300)
                .attr("d", d => line(d.values));

            seriesSelection.exit().remove();

            bindHover(series, metric);
            updateNarrativeAndSummary(series, start, end, metric, isAllSelected);
        }

        /* =========================
           CLEAR CHART
        ========================= */
        function clearChart() {
            g.selectAll(".line, .area").attr("d", null);
            g.selectAll(".single-point").remove();
            focus.style("opacity", 0);
            tooltip.style("display", "none");
            updateSummary(null);
        }

        /* =========================
           HOVER INTERACTION
        ========================= */
        function bindHover(series, metric) {
            if (!series || series.length === 0) {
                svg.on("mousemove", null);
                svg.on("mouseleave", null);
                return;
            }

            svg.on("mousemove", (event) => {
                const [mx] = d3.pointer(event, svg.node());
                const chartX = mx - MARGIN.left;
                if(chartX < 0 || chartX > WIDTH) { 
                    focus.style("opacity", 0);
                    tooltip.style("display", "none");
                    return;
                }

                const year = Math.round(x.invert(chartX));

                // Find closest point per series
                const rows = series.map(s => {
                    const closest = s.values.reduce((a, b) =>
                        Math.abs(b.year - year) < Math.abs(a.year - year) ? b : a
                    );
                    return `<div style="margin-bottom: 4px;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: ${color(s.cause)}; border-radius: 2px; margin-right: 6px;"></span>
                        <strong>${s.cause}</strong>: ${formatValue(closest.value, metric)}
                    </div>`;
                }).join("");

                focus.style("opacity", 1)
                    .attr("cx", x(year))
                    .attr("cy", y(d3.max(series.flatMap(s => s.values.map(v => v.value)))));

                const rect = container.getBoundingClientRect();
                const tooltipX = event.clientX - rect.left + 10;
                const tooltipY = event.clientY - rect.top - 60;

                tooltip.style("display","block")
                    .style("left",`${Math.min(tooltipX, rect.width-200)}px`)
                    .style("top",`${Math.min(tooltipY, rect.height-100)}px`)
                    .html(`
                        <div class="tooltip-year">Year: ${year}</div>
                        ${rows}
                    `);
            });

            svg.on("mouseleave", () => {
                focus.style("opacity", 0);
                tooltip.style("display", "none");
            });
        }

        /* =========================
           NARRATIVE AND SUMMARY
        ========================= */
        function updateNarrativeAndSummary(series, startYear, endYear, metric, isAllSelected) {
            if (!series || series.length === 0) {
                document.getElementById("trend-changes").innerHTML = `<p>No data available for the selected filters.</p>`;
                document.getElementById("trend-comparison").innerHTML = `<p>No data available.</p>`;
                updateSummary(null);
                return;
            }
            
            let changesHTML = '';
            let summaryHTML = '';
            
            if (isAllSelected) {
                // For "All Causes"
                const totalSeries = series[0];
                const first = totalSeries.values[0];
                const last = totalSeries.values[totalSeries.values.length - 1];
                const totalChange = first.value > 0 
                    ? ((last.value - first.value) / first.value) * 100 
                    : 0;
                
                // Calculate fastest growing/declining causes
                calculateFastestCauses(startYear, endYear).then(result => {
                    document.getElementById('fastest-growing').textContent = 
                        result.fastestGrowing ? `${result.fastestGrowing.cause} (+${result.fastestGrowing.change.toFixed(1)}%)` : "--";
                    document.getElementById('fastest-declining').textContent = 
                        result.fastestDeclining ? `${result.fastestDeclining.cause} (${result.fastestDeclining.change.toFixed(1)}%)` : "--";
                });
                
                changesHTML = `
                    <div class="change-metric">
                        <div class="metric-value">${Math.abs(totalChange).toFixed(1)}%</div>
                        <div class="metric-label">Total ${totalChange >= 0 ? 'increase' : 'decrease'}</div>
                    </div>
                    <div class="change-metric">
                        <div class="metric-value">${(totalChange / (endYear - startYear)).toFixed(2)}%</div>
                        <div class="metric-label">Annual change</div>
                    </div>
                `;
                
                summaryHTML = `
                    <p><strong>Time Period:</strong> ${startYear}-${endYear}</p>
                    <p><strong>Total Change:</strong> ${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(1)}%</p>
                    <p><strong>End Value:</strong> ${formatValue(last.value, metric)}</p>
                `;
                
            } else {
                // For specific causes
                const firstValues = series.map(s => s.values[0].value);
                const lastValues = series.map(s => s.values[s.values.length - 1].value);
                
                const totalStart = d3.sum(firstValues);
                const totalEnd = d3.sum(lastValues);
                const totalChange = totalStart > 0 ? ((totalEnd - totalStart) / totalStart) * 100 : 0;
                
                changesHTML = `<p>Showing <strong>${series.length}</strong> selected causes:</p>`;
                series.forEach(s => {
                    const first = s.values[0];
                    const last = s.values[s.values.length - 1];
                    const change = first.value > 0 ? ((last.value - first.value) / first.value) * 100 : 0;
                    changesHTML += `
                        <p style="margin: 5px 0; padding-left: 15px; border-left: 3px solid ${color(s.cause)}">
                            <strong>${s.cause}</strong>: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%
                        </p>
                    `;
                });
                
                summaryHTML = `
                    <p><strong>Combined Change:</strong> ${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(1)}%</p>
                    <p><strong>Total (${endYear}):</strong> ${formatValue(totalEnd, metric)}</p>
                `;
                
                document.getElementById('fastest-growing').textContent = "--";
                document.getElementById('fastest-declining').textContent = "--";
            }
            
            document.getElementById("trend-changes").innerHTML = changesHTML;
            document.getElementById("trend-comparison").innerHTML = summaryHTML;
            
            // Update summary values
            const lastValue = series.reduce((sum, s) => sum + s.values[s.values.length - 1].value, 0);
            updateSummary(lastValue, totalChange, metric, endYear);
        }

        /* =========================
           UPDATE SUMMARY VALUES
        ========================= */
        function updateSummary(lastValue, change, metric, endYear) {
            if (lastValue === null) {
                document.getElementById('total-deaths').textContent = "--";
                document.getElementById('percent-change').textContent = "--";
                return;
            }
            
            const totalDeaths = metric === "absolute" 
                ? d3.format(",.0f")(lastValue)
                : d3.format(",.1f")(lastValue);
            
            const percentChange = change !== undefined ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : "--";
            
            document.getElementById('total-deaths').textContent = totalDeaths;
            document.getElementById('percent-change').textContent = percentChange;
        }

        /* =========================
           HELPER FUNCTIONS
        ========================= */
        function calculateFastestCauses(startYear, endYear) {
            return new Promise((resolve) => {
                const causes = [...new Set(raw.map(d => d.cause))];
                const causeChanges = [];
                
                causes.forEach(cause => {
                    const causeData = raw.filter(d => 
                        d.cause === cause && 
                        (d.year === startYear || d.year === endYear)
                    );
                    
                    const startData = causeData.find(d => d.year === startYear);
                    const endData = causeData.find(d => d.year === endYear);
                    
                    if (startData && endData && startData.deaths > 0) {
                        const change = ((endData.deaths - startData.deaths) / startData.deaths) * 100;
                        causeChanges.push({
                            cause: cause,
                            change: change,
                            startDeaths: startData.deaths,
                            endDeaths: endData.deaths
                        });
                    }
                });
                
                // Sort by change percentage
                causeChanges.sort((a, b) => b.change - a.change);
                
                const fastestGrowing = causeChanges.length > 0 && causeChanges[0].change > 0 
                    ? causeChanges[0] 
                    : null;
                
                const fastestDeclining = causeChanges.length > 0 && causeChanges[causeChanges.length - 1].change < 0
                    ? causeChanges[causeChanges.length - 1]
                    : null;
                
                resolve({ fastestGrowing, fastestDeclining });
            });
        }

        function formatValue(value, metric) {
            if (metric === "absolute") {
                return d3.format(",.0f")(value);
            } else {
                return d3.format(",.1f")(value);
            }
        }

        function color(cause) {
            // Use a deterministic color scheme
            const colors = [
                '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
                '#1abc9c', '#d35400', '#c0392b', '#16a085', '#8e44ad',
                '#27ae60', '#f1c40f', '#e67e22', '#7f8c8d', '#2c3e50'
            ];
            
            // Create a hash from the cause name
            let hash = 0;
            for (let i = 0; i < cause.length; i++) {
                hash = cause.charCodeAt(i) + ((hash << 5) - hash);
            }
            
            return colors[Math.abs(hash) % colors.length];
        }

        /* =========================
           SLIDER TRACK UPDATE
        ========================= */
        function updateSliderTrack() {
            const startSlider = document.getElementById('time-start');
            const endSlider = document.getElementById('time-end');
            const rangeSlider = document.querySelector('.range-slider');
            
            const min = parseInt(startSlider.min);
            const max = parseInt(startSlider.max);
            const startPercent = ((startSlider.value - min) / (max - min)) * 100;
            const endPercent = ((endSlider.value - min) / (max - min)) * 100;
            
            rangeSlider.style.background = `linear-gradient(to right, 
                #f0f0f0 0%, 
                #f0f0f0 ${startPercent}%, 
                #3498db ${startPercent}%, 
                #3498db ${endPercent}%, 
                #f0f0f0 ${endPercent}%, 
                #f0f0f0 100%)`;
        }
    });