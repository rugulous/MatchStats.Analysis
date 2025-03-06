import type { Event } from "./types";

export function categoriseEvents(events: {home: Event[], away: Event[]}){
    const categories: { [key: string]: any } = {
        "Cross": {
            home: 0,
            away: 0,
            substats: {
                "Won": { home: 0, away: 0 },
                "Lost": { home: 0, away: 0 },
                "Missed": { home: 0, away: 0 }
            }
        },
        "Shot":  {
            home: 0,
            away: 0,
            substats: {
                "On Target": { home: 0, away: 0 },
                "Goals": { home: 0, away: 0, calculateTotalFrom: "On Target" },
                "Blocked": { home: 0, away: 0 },
                "Off Target": { home: 0, away: 0 }
            }
        },
        "Corner":  {
            home: 0,
            away: 0,
            substats: {
                "Short": { home: 0, away: 0 },
                "Crossed": { home: 0, away: 0 }
            }
        }
    }

    const substatConfig: {[key: string]: {[key: string]: number[]}} = {
        "Shot": {
            "On Target": [9, 8],
            "Goals": [9],
            "Blocked": [7],
            "Off Target": [10, 16]
        },
        "Corner": {
            "Short": [11],
            "Crossed": [12]
        },
        "Cross": {
            "Won": [1, 2],
            "Lost": [3, 4, 13, 15],
            "Missed": [5, 6, 14]
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

    return categories;
}
