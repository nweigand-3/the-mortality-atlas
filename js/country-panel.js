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
            <strong>${top.cause}</strong> was the leading cause at ${formatPercent(percent)}% contribution,
            responsible for <strong>${formatInt(top.deaths)}</strong> deaths.
        `;
    }

    if(second) {
        summary += `
            <br>
            The second leading cause was <strong>${second.cause}</strong> at ${formatPercent(percent2)}% contribution,
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
    const lowYear = data.reduce((min, d) => d.per100k < min.per100k ? d : min, data[0]); // FIXED

    if (peakYear !== firstYear && peakYear !== lastYear) {
        narrative += ` The peak was in ${peakYear.year} with ${formatRate(peakYear.per100k)} deaths per 100k.`;
    }

    return narrative;
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
        const sepY = (y(sorted[cutoffIndex].cause) + y(sorted[cutoffIndex + 1].cause)) / 2 + 20;
        
        g.append("line")
            .attr("x1", 0)
            .attr("x2", width + 100)
            .attr("y1", sepY) + 10
            .attr("y2", sepY + 10)
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
            .attr("y1", sepY + 5)
            .attr("y2", sepY + 5)
            .attr("stroke", "#888")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "2 2");
        
        g.append("text")
            .attr("x", width + 105)
            .attr("y", sepY + 5)
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
    
    //const narrative = generateInsightfulTrendNarrative(dataWithRate);
    //d3.select("#country-trend-summary").html(`<p>${narrative}</p>`);
    
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
        .attr("x", -margin.left + 5)
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