import express from 'express';
import { engine } from 'express-handlebars';
import { readFileSync } from 'fs';
import path from 'path';

type StatType = "Shot" | "Cross" | "Corner";

type Event = {
    id: number;
    statTypeID: number;
    statType: StatType;
    time: number;
    outcomeId: number;
    outcome: string;
}

type Segment = {
    name: string;
    code: string;
    startTime: number;
    duration: 45 | 15;
    events: {
        home: Event[];
        away: Event[];
    }
}

type Data = {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    segments: Segment[];
};

function categoriseEvents(events: {home: Event[], away: Event[]}){
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

function buildOverallSegment(segments: Segment[]): Segment{
    const home = segments.flatMap(segment => segment.events.home);
    const away = segments.flatMap(segment => segment.events.away);

    return {
        name: "Overall",
        startTime: 0,
        events: {home, away},
        duration: 45,
        code: ""
    };
}

const app = express();

app.engine("hbs", engine({
    extname: ".hbs",
    helpers: {
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
        getRoutes: () => ["Timeline", "Stats", "Graphs"],
        eq: (a: any, b: any) => a == b,
        lower: (str: string) => str.toLowerCase(),
        multiply: (a: number, b: number) => a * b,
        add: (a: number, b: number) => a + b
    }
}));

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

const getData = () => {
    const data: Data = JSON.parse(readFileSync(path.join(__dirname, "data.json"), "utf8"));
    const title = `${data.homeTeam} ${data.homeScore}-${data.awayScore} ${data.awayTeam}`;
    return {data, title};
}

app.get('/', (_, res) => res.redirect("/timeline"));
app.get('/timeline', (_, res) => res.render('timeline.hbs', getData()));
app.get('/stats', (_, res) => {
    const data = getData();

    //add a dummy "Overall" segment
    
    data.data.segments.unshift(buildOverallSegment(data.data.segments));

    res.render('stats.hbs', data)
});
app.get('/graphs', (_, res) => {
    const {data, title} = getData();

    const stats: {
        momentum: number[][],
        home: Record<StatType, number>[][],
        away: Record<StatType, number>[][],
        segments: {name: string, code: string}[],
        maxMomentum: number,
        maxStats: number
    } = {
        momentum: [],
        home: [],
        away: [],
        segments: [],
        maxMomentum: 0,
        maxStats: 0
    };

    data.segments.forEach((segment, ix) => {
        const numSegments = Math.floor(segment.duration / 5);
        const momentum: number[] = Array(numSegments).fill(0);
        //if we just fill these with [], JS makes it a reference to the same object (i.e. [].push pushes to ALL)
        const home: Record<StatType, number>[] = Array(numSegments).fill(0).map(_ => ({Shot: 0, Cross: 0, Corner: 0}));
        const away: Record<StatType, number>[] = Array(numSegments).fill(0).map(_ => ({Shot: 0, Cross: 0, Corner: 0}));

        segment.events.home.forEach(e => {
            let section = Math.floor((((e.time - segment.startTime) / 1000) / 60) / 5);
            if(section >= numSegments){
                section = numSegments - 1; //added time
            }
            
            momentum[section]++;
            home[section][e.statType]++;
        });

        segment.events.away.forEach(e => {
            let section = Math.floor((((e.time - segment.startTime) / 1000) / 60) / 5);
            if(section >= momentum.length){
                section = momentum.length; //added time
            }

            momentum[section]--;
            away[section][e.statType]++;
        });

        stats.momentum.push(momentum);
        stats.home.push(home);
        stats.away.push(away);
        stats.segments.push({name: segment.name, code: segment.code});

        for(let i = 0; i < numSegments; i++){
            if(momentum[i] > stats.maxMomentum){
                stats.maxMomentum = momentum[i];
            }

            if(home[i].Shot + home[i].Cross + home[i].Corner > stats.maxStats){
                stats.maxStats = home[i].Shot + home[i].Cross + home[i].Corner;
            }

            if(away[i].Shot + away[i].Cross + away[i].Corner > stats.maxStats){
                stats.maxStats = away[i].Shot + away[i].Cross + away[i].Corner;
            }
        }
    });

    const overall = buildOverallSegment(data.segments);
    const categories = categoriseEvents(overall.events);

    //for this specific situation, we want to class goals and shots on target as different events (whereas previously they've been a percentage of each other)
    const target = categories.Shot.substats['On Target'];
    const goals = categories.Shot.substats.Goals;

    target.home -= goals.home;
    target.away -= goals.away;

    res.render('graphs.hbs', {title, homeTeam: data.homeTeam, awayTeam: data.awayTeam, categories, ...stats});
});

app.listen(3000, () => "Listening on port 3000!");