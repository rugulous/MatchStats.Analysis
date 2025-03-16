import type { Event } from "./types";

export function categoriseEvents(events: {home: Event[], away: Event[]}, viaApp: boolean){
    const categories: { [key: string]: any } = {
        "Cross": {
            home: 0,
            away: 0,
            substats: {
                "Won": { home: 0, away: 0 },
                "Lost": { home: 0, away: 0 },
                "Missed": { home: 0, away: 0 },
                "Unknown": {home: 0, away: 0}
            }
        },
        "Shot":  {
            home: 0,
            away: 0,
            substats: {
                "On Target": { home: 0, away: 0 },
                "Goals": { home: 0, away: 0, calculateTotalFrom: "On Target" },
                "Blocked": { home: 0, away: 0 },
                "Off Target": { home: 0, away: 0 },
                "Unknown": {home: 0, away: 0}
            }
        },
        "Corner":  {
            home: 0,
            away: 0,
            substats: {
                "Short": { home: 0, away: 0 },
                "Crossed": { home: 0, away: 0 },
                "Unknown": {home: 0, away: 0}
            }
        }
    }

    const substatConfig: {[key: string]: {[key: string]: number[]}} = {
        "Shot": {
            "On Target": [9, 8],
            "Goals": [9],
            "Blocked": [7],
            "Off Target": [10, 16],
            "Unknown": [18]
        },
        "Corner": {
            "Short": [11],
            "Crossed": [12],
            "Unknown": [19]
        },
        "Cross": {
            "Won": [1, 2],
            "Lost": [3, 4, 13, 15],
            "Missed": [5, 6, 14],
            "Unknown": [17]
        }
    }



    events.home.forEach(event => {
        categories[event.statType].home++;
        Object.keys(substatConfig[event.statType]).forEach(k => {
            if(substatConfig[event.statType][k].some(x => x == event.outcomeId)){
                categories[event.statType].substats[k].home++;
            }
        })
    });

    events.away.forEach(event => {
        categories[event.statType].away++;
        Object.keys(substatConfig[event.statType]).forEach(k => {
            if(substatConfig[event.statType][k].some(x => x == event.outcomeId)){
                categories[event.statType].substats[k].away++;
            }
        })
    });

    if(!viaApp){
        const statsToKeep = ["On Target", "Goals", "Off Target"];

        categories.Cross.substats = {};
        categories.Corner.substats = {};
        Object.keys(categories.Shot.substats).forEach(k => {
            if(!statsToKeep.includes(k)){
                delete categories.Shot.substats[k];
            }
        });
    } else {
        Object.keys(categories).forEach(k => {
            //we want to remove unknowns, UNLESS there actually are any!
            const {home, away} = categories[k].substats.Unknown;
            if(home + away == 0){
                delete categories[k].substats.Unknown;
            }
        });
    }

    return categories;
}

export function tryParseInt(string: string, fallback: number){
    const val = parseInt(string);
    if(isNaN(val)){
        return fallback;
    }

    return val;
}

export function formatTimestamp(elapsedSeconds: number, minuteOffset: number = 0){
    elapsedSeconds += (minuteOffset * 60) - 5; //5 second buffer to show runup/allow for recording time
    const minutes =  Math.floor(elapsedSeconds / 60);
    const seconds = Math.floor(elapsedSeconds % 60);
    return minutes.toString().padStart(2, '0') + ":" + seconds.toString().padStart(2, '0');
}