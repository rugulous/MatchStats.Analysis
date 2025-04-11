import type { Segment, StatType } from "./types";
import { categoriseEvents } from "./utils";
import {SafeString} from "handlebars";

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
        eachStatCategory: (segment: Segment, viaApp: boolean, options: Handlebars.HelperOptions) => {
            const categories = categoriseEvents(segment.events, viaApp);

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
        getTime: (eventTimestamp: number, startTime: number, minuteOffset: number, videoOffsetSeconds: number = 0) => {
            //if not passed, could be handlebars options
            if(isNaN(videoOffsetSeconds)){
                videoOffsetSeconds = 0;
            } else {
                //subtract a buffer so we can see the buildup to the event
                videoOffsetSeconds -= 5;
            }

            const time = ((eventTimestamp - startTime) / 1000) + videoOffsetSeconds;
            const minutes = minuteOffset + Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return minutes.toString().padStart(2, '0') + ":" + seconds.toString().padStart(2, '0');
        },
        getRoutes: (hasTimestamps: boolean) => {
            const pages = ["Stats"];

            if(hasTimestamps){
                pages.push("Timeline", "Graphs");
            }
            
            return pages;
        },
        eq: (a: any, b: any) => a == b,
        lower: (str: string) => str.toLowerCase(),
        multiply: (a: number, b: number) => a * b,
        add: (a: number, b: number) => a + b,
        fmtDate: (date: Date) => date.toLocaleString('en-GB'),
        dateOnly: (date: Date) => date.toLocaleDateString('en-GB'),
        printMomentumConfig: (momentumConfig: Record<StatType, number>) => new SafeString((Object.keys(momentumConfig) as StatType[]).map(k => `${k} = <b>${momentumConfig[k]}</b>`).join(", ")),
        calculateStatPercent: (total: number, outOf: number) => {
            console.log(total);
            console.log(outOf);
            const result = Math.round((total / outOf) * 100);
            console.log(result);
            if(isNaN(result)){
                return 0;
            }
            return result;
        },
        ifNull: (val: any, fallback: any) => val ?? fallback
    }