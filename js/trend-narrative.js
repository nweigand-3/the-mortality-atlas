function generateInsightfulTrendNarrative(data)
{
    if(!data || !data.length)
    {
        return "No trend data available.";
    }
    
    const dataWithRate = data.map(d => ({
        year: d.year,
        totalDeaths: d.totalDeaths,
        per100k: d.per100k
    }));
    
    const overall = analyzeOverallTrajectory(dataWithRate);
    const phases = detectMeaningfulPhases(dataWithRate);
    const trendRelationship = analyzeTrendRelationship(dataWithRate);
    
    return buildPolishedNarrative(dataWithRate, overall, phases, trendRelationship);
}

function analyzeOverallTrajectory(data)
{
    const first = data[0];
    const last = data[data.length - 1];
    const midIdx = Math.floor(data.length / 2);
    const mid = data[midIdx];
    
    const absChange = ((last.totalDeaths - first.totalDeaths) / first.totalDeaths) * 100;
    const perCapitaChange = ((last.per100k - first.per100k) / first.per100k) * 100;
    const populationImplication = perCapitaChange - absChange;
    
    const peak = d3.max(data, d => d.totalDeaths);
    const trough = d3.min(data, d => d.totalDeaths);
    const peakYear = data.find(d => d.totalDeaths === peak).year;
    const troughYear = data.find(d => d.totalDeaths === trough).year;
    
    return {
        absChange,
        perCapitaChange,
        populationImplication,
        peak,
        trough,
        peakYear,
        troughYear,
        firstYear: first.year,
        lastYear: last.year
    };
}

function detectMeaningfulPhases(data)
{
    if(data.length < 5)
    {
        return [];
    }
    
    const phases = [];
    const minPhaseLength = 4;
    const significantChange = 0.03;
    
    let startIdx = 0;
    let currentDirection = null;
    let accumulatedChange = 0;
    
    for(let i = 1; i < data.length; i++)
    {
        const annualChange = (data[i].totalDeaths - data[i-1].totalDeaths) / data[i-1].totalDeaths;
        const direction = annualChange > significantChange ? 'up' : 
                         annualChange < -significantChange ? 'down' : 'flat';
        
        if(!currentDirection)
        {
            currentDirection = direction;
        }
        
        const yearsCovered = data[i].year - data[startIdx].year;
        const hasSignificantAccumulated = Math.abs(accumulatedChange) > 0.1;
        
        if((direction !== currentDirection && hasSignificantAccumulated && yearsCovered >= minPhaseLength) || 
           (direction === 'flat' && currentDirection !== 'flat' && yearsCovered >= minPhaseLength))
        {
            phases.push({
                startYear: data[startIdx].year,
                endYear: data[i-1].year,
                direction: currentDirection,
                magnitude: accumulatedChange,
                startValue: data[startIdx].totalDeaths,
                endValue: data[i-1].totalDeaths
            });
            
            startIdx = i-1;
            currentDirection = direction;
            accumulatedChange = annualChange;
        }
        else
        {
            accumulatedChange += annualChange;
        }
    }
    
    if(data.length - startIdx >= minPhaseLength || Math.abs(accumulatedChange) > 0.05)
    {
        phases.push({
            startYear: data[startIdx].year,
            endYear: data[data.length-1].year,
            direction: currentDirection,
            magnitude: accumulatedChange,
            startValue: data[startIdx].totalDeaths,
            endValue: data[data.length-1].totalDeaths
        });
    }
    
    return phases.filter(p => 
        Math.abs(p.magnitude) > 0.05 || 
        (p.endYear - p.startYear) >= 5
    );
}

function analyzeTrendRelationship(data)
{
    const first = data[0];
    const last = data[data.length - 1];
    
    const absTrend = last.totalDeaths > first.totalDeaths ? 'rising' : 'falling';
    const perCapitaTrend = last.per100k > first.per100k ? 'rising' : 'falling';
    
    const divergence = absTrend !== perCapitaTrend;
    const divergenceMagnitude = Math.abs(
        ((last.per100k - first.per100k) / first.per100k) - 
        ((last.totalDeaths - first.totalDeaths) / first.totalDeaths)
    ) * 100;
    
    let populationStory = null;
    if(divergence && divergenceMagnitude > 15)
    {
        if(absTrend === 'rising' && perCapitaTrend === 'falling')
        {
            populationStory = "population growth has outpaced the increase in deaths";
        }
        else if(absTrend === 'falling' && perCapitaTrend === 'rising')
        {
            populationStory = "a shrinking population has masked worsening health outcomes";
        }
        else if(absTrend === 'flat' && perCapitaTrend !== 'flat')
        {
            populationStory = "population changes have been the main driver of per capita trends";
        }
    }
    
    return {
        divergence,
        divergenceMagnitude,
        populationStory,
        absTrend,
        perCapitaTrend
    };
}

function buildPolishedNarrative(data, overall, phases, relationship)
{
    const narratives = [];
    const firstYear = data[0].year;
    const lastYear = data[data.length - 1].year;
    
    const absChangeDesc = Math.abs(overall.absChange) < 5 ? "remained relatively stable" :
                         overall.absChange > 0 ? `increased by ${Math.abs(overall.absChange).toFixed(1)}%` :
                         `declined by ${Math.abs(overall.absChange).toFixed(1)}%`;
    
    const perCapitaChangeDesc = Math.abs(overall.perCapitaChange) < 5 ? "remained relatively stable" :
                               overall.perCapitaChange > 0 ? `increased by ${Math.abs(overall.perCapitaChange).toFixed(1)}%` :
                               `declined by ${Math.abs(overall.perCapitaChange).toFixed(1)}%`;
    
    narratives.push(`Between ${firstYear} and ${lastYear}, total deaths ${absChangeDesc}, while the death rate per 100,000 people ${perCapitaChangeDesc}.`);
    
    if(phases.length > 0)
    {
        const majorPhases = phases.filter(p => Math.abs(p.magnitude) > 0.1);
        
        if(majorPhases.length > 0)
        {
            narratives.push("The most significant trends emerged in distinct periods:");
            
            majorPhases.forEach(phase =>
            {
                const percentChange = phase.magnitude * 100;
                const directionWord = phase.direction === 'up' ? 'rose' : 
                                    phase.direction === 'down' ? 'fell' : 'stabilized';
                const magnitudeWord = Math.abs(percentChange) > 20 ? 'sharply' :
                                     Math.abs(percentChange) > 10 ? 'significantly' :
                                     Math.abs(percentChange) > 5 ? 'moderately' : 'slightly';
                
                if(phase.startYear === phase.endYear)
                {
                    narratives.push(`In ${phase.startYear}, deaths ${directionWord} ${magnitudeWord}.`);
                }
                else
                {
                    narratives.push(`From ${phase.startYear} to ${phase.endYear}, deaths ${directionWord} ${magnitudeWord} (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%).`);
                }
            });
        }
    }
    
    if(relationship.populationStory)
    {
        narratives.push(`Notably, ${relationship.populationStory}, indicating that demographic changes have played a key role.`);
    }
    
    if(overall.peak !== overall.trough)
    {
        const peakTroughRatio = overall.peak / overall.trough;
        
        if(peakTroughRatio > 1.3)
        {
            narratives.push(`The most dramatic swing occurred between ${overall.troughYear} (${formatInt(overall.trough)} deaths) and ${overall.peakYear} (${formatInt(overall.peak)} deaths), representing a ${((peakTroughRatio - 1) * 100).toFixed(0)}% variation.`);
        }
    }
    
    return narratives.join(' ');
}