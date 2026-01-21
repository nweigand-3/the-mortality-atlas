// Formatting functions
const formatInt = d =>
{
    return d.toLocaleString("en-US");
};

const formatRate = d =>
{
    return d.toLocaleString("en-US",
    {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
};

const formatPercent = d =>
{
    return d.toLocaleString("en-US",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// Country code extraction
function getCountryCode(feature)
{
    if(!feature || !feature.properties)
    {
        return null;
    }
    
    const props = feature.properties;
    
    if(props.wb_a3 && props.wb_a3 !== -99 && props.wb_a3 !== "-99")
    {
        return props.wb_a3;
    }
    
    if(props.adm0_a3 && props.adm0_a3 !== -99 && props.adm0_a3 !== "-99" && props.adm0_a3.length === 3)
    {
        return props.adm0_a3;
    }
    
    if(props.iso_a3 && props.iso_a3 !== -99 && props.iso_a3 !== "-99")
    {
        return props.iso_a3;
    }
    
    return null;
}

// Data processing utilities
function getAvailableCauses(mortalityData)
{
    if(!mortalityData)
    {
        return ["Loading..."];
    }
    return [...new Set(mortalityData.map(d => d.CauseOfDeath))].sort();
}