import type { Segment } from "./types";
import { categoriseEvents } from "./utils";

export default {
        json: (obj: any) => JSON.stringify(obj),
        eachStat: (segment: Segment, options: Handlebars.HelperOptions) => {
            const combined = [...segment.events.home.map(e => ({
                ...e,
                isHome: true
            })), ...segment.events.away.map(e => ({
                ...e,
                isHome: false
            }))].sort((a, b) => a.time - b.time);

            return combined.map(event => options.fn(event)).join("");
        },
        eachStatCategory: (segment: Segment, options: Handlebars.HelperOptions) => {
            const categories = categoriseEvents(segment.events);

            return Object.keys(categories).map((k, i) => {
                const cat = categories[k];

                Object.keys(cat.substats).forEach(nestedKey => {
                    const el = cat.substats[nestedKey];
                    let homeTotal = cat.home;
                    let awayTotal = cat.away;

                    if(el.calculateTotalFrom){
                        homeTotal = cat.substats[el.calculateTotalFrom].home;
                        awayTotal = cat.substats[el.calculateTotalFrom].away;
                    }

                    el.homePc = (homeTotal == 0) ? 0 : Math.round((el.home / homeTotal) * 100);
                    el.awayPc = (awayTotal == 0) ? 0 : Math.round((el.away / awayTotal) * 100);
                });

                return options.fn({...cat, stat: k, isFirst: i == 0});
            }).join("");
        },
        getTime: (eventTimestamp: number, startTime: number, minuteOffset: number) => {
            const time = (eventTimestamp - startTime) / 1000;
            const minutes = minuteOffset + Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return minutes.toString().padStart(2, '0') + ":" + seconds.toString().padStart(2, '0');
        },
        getRoutes: () => ["Stats", "Timeline", "Graphs"],
        eq: (a: any, b: any) => a == b,
        lower: (str: string) => str.toLowerCase(),
        multiply: (a: number, b: number) => a * b,
        add: (a: number, b: number) => a + b
    }