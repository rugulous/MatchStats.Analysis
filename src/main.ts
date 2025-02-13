import express from 'express';
import { engine } from 'express-handlebars';
import { readFileSync } from 'fs';
import path from 'path';

const app = express();

app.engine("hbs", engine({
    extname: ".hbs",
    helpers: {
        json: (obj: any) => JSON.stringify(obj),
        eachStat: (segment: any, options: Handlebars.HelperOptions) => {
            const combined = [...segment.events.home.map((e: any) => ({
                ...e,
                isHome: true
            })), ...segment.events.away.map((e: any) => ({
                ...e,
                isHome: false
            }))].sort((a, b) => a.time - b.time);

            return combined.map(event => options.fn(event)).join("");
        },
        eachStatCategory: (segment: any, options: Handlebars.HelperOptions) => {
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
                    "Off Target": [10]
                },
                "Corner": {
                    "Short": [11],
                    "Crossed": [12]
                },
                "Cross": {
                    "Won": [1, 2],
                    "Lost": [3, 4],
                    "Missed": [5, 6]
                }
            }

            segment.events.home.forEach((event: any) => {
                categories[event.statType].home++;
                Object.keys(substatConfig[event.statType]).forEach(k => {
                    if(substatConfig[event.statType][k].some(x => x == event.outcomeId)){
                        categories[event.statType].substats[k].home++;
                    }
                })
            });

            segment.events.home.forEach((event: any) => {
                categories[event.statType].away++;
                Object.keys(substatConfig[event.statType]).forEach(k => {
                    if(substatConfig[event.statType][k].some(x => x == event.outcomeId)){
                        categories[event.statType].substats[k].away++;
                    }
                })
            });

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
        getRoutes: () => ["Timeline", "Stats"],
        eq: (a: any, b: any) => a == b,
        lower: (str: string) => str.toLowerCase()
    }
}));

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

const getData = () => {
    const data = JSON.parse(readFileSync(path.join(__dirname, "data.json"), "utf8"));
    const title = `${data.homeTeam} ${data.homeScore}-${data.awayScore} ${data.awayTeam}`;
    return {data, title};
}

app.get('/', (_, res) => res.redirect("/timeline"));
app.get('/timeline', (_, res) => res.render('timeline.hbs', getData()));
app.get('/stats', (_, res) => {
    const data = getData();

    //add a dummy "Overall" segment
    const home = data.data.segments.flatMap((segment: any) => segment.events.home);
    const away = data.data.segments.flatMap((segment: any) => segment.events.home);
    data.data.segments.unshift({
        name: "Overall",
        events: {home, away}
    });

    res.render('stats.hbs', data)
});

app.listen(3000, () => "Listening on port 3000!");