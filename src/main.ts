import express from 'express';
import { engine } from 'express-handlebars';
import path from 'path';
import 'dotenv/config';
import { createManualMatch, getActiveMonths, getMatchAndShallowSegments, getStats, getStatTypes, getTimeline, listMatches, loadMatch, saveMatch, setVideoLink, setVideoOffset } from './db';
import { Data, Segment, StatType } from './types';

import handlebarsHelpers from './handlebars-helpers';
import { categoriseEvents, tryParseInt } from './utils';

function buildOverallSegment(segments: Segment[]): Segment{
    const home = segments.flatMap(segment => segment.events.home);
    const away = segments.flatMap(segment => segment.events.away);

    return {
        name: "Overall",
        startTime: 0,
        events: {home, away},
        duration: 45,
        code: "",
        minuteOffset: 0,
        videoOffset: null
    };
}

const app = express();

app.engine("hbs", engine({
    extname: ".hbs",
    helpers: handlebarsHelpers
}));

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

app.use(express.json());
app.use(express.urlencoded({extended: true}));

const getData = async (id: string) => {
    const data: Data | null = await loadMatch(id);
    if(!data){
        return null;
    }

    const title = `${data.homeTeam} ${data.homeScore}-${data.awayScore} ${data.awayTeam}`;
    return {data, title};
}

app.get("/paper-stats", (_, res) => res.render("paper-stats.hbs", {
    title: "Add Paper Stats"
}));

app.post("/paper-stats", async (req, res) => {
    const id = await createManualMatch({
        homeTeam: req.body.home,
        awayTeam: req.body.away,
        date: req.body.date,
        notes: req.body.notes,
        videoLink: req.body.video,
        homeEvents: {
            firstHalf: {
                cross: parseInt(req.body.h_cross_1h),
                shot: parseInt(req.body.h_shot_1h),
                shotOnTarget: parseInt(req.body.h_target_1h),
                goal: parseInt(req.body.h_goals_1h),
                corner: parseInt(req.body.h_corners_1h)
            },
            secondHalf: {
                cross: parseInt(req.body.h_cross_2h),
                shot: parseInt(req.body.h_shot_2h),
                shotOnTarget: parseInt(req.body.h_target_2h),
                goal: parseInt(req.body.h_goals_2h),
                corner: parseInt(req.body.h_corners_2h)
            }
        },
        awayEvents: {
            firstHalf: {
                cross: parseInt(req.body.a_cross_1h),
                shot: parseInt(req.body.a_shot_1h),
                shotOnTarget: parseInt(req.body.a_target_1h),
                goal: parseInt(req.body.a_goals_1h),
                corner: parseInt(req.body.a_corners_1h)
            },
            secondHalf: {
                cross: parseInt(req.body.a_cross_2h),
                shot: parseInt(req.body.a_shot_2h),
                shotOnTarget: parseInt(req.body.a_target_2h),
                goal: parseInt(req.body.a_goals_2h),
                corner: parseInt(req.body.a_corners_2h)
            }
        }
    });
    res.redirect(`/${id}`);
});

app.get("/", async (_, res) => {
    const [matches, stats, [latestMonth]] = await Promise.all([listMatches(), getStats({forTeam: "Totty"}), getActiveMonths()]);

    res.render('list-matches.hbs', {
        title: "All Matches",
        matches: matches,
        allStats: stats,
        statStart: new Date(matches[matches.length - 1].StartTime),
        latestMonth
    });
});

app.get("/stat-sync", async (_, res) => {
    res.json(await getStatTypes());
});

app.get("/stats", async (req, res) => {
    const now = new Date();
    let year = parseInt(req.query.year as string);
    let month = parseInt(req.query.month as string);

    if(isNaN(year)){
        year = now.getFullYear();
    }

    if(isNaN(month)){
        month = now.getMonth();
    }

    const targetMonth = new Date(year, month, 1);
    const [matches, stats, activeMonths] = await Promise.all([listMatches(targetMonth), getStats({forTeam: "Totty", month: targetMonth}), getActiveMonths()]);

    res.render('stat-detail.hbs', {
        title: targetMonth.toLocaleDateString("en-GB", {year: 'numeric', month: 'long'}) + " Stats",
        matches: await Promise.all(matches.map(async match => {
            return {
                ...match,
                segments: await Promise.all(match.Segments.map(async s => await getStats({matchSegmentId: s})))
            }
        })),
        allStats: stats,
        noMatches: matches.length == 0,
        month: targetMonth,
        activeMonths: activeMonths.map(m => ({
            year: m.Year,
            month: m.Month,
            label: new Date(m.Year, m.Month, 1).toLocaleDateString("en-GB", {month: 'long', year: 'numeric'})
        }))
    });
});

app.get('/:id/timeline', async (req, res) => {
    const data = await getTimeline(req.params.id);
    if(!data){
        res.status(404).send();
        return;
    }

    res.render('timeline.hbs', {
        title: `${data.homeTeam} ${data.homeGoals}-${data.awayGoals} ${data.awayTeam}`,
        hasTimestamps: data.hasTimestamps,
        videoLink: data.videoLink,
        segments: data.segments
    })
});
app.get('/:id/stats', async (req, res) => {
    const match = await getMatchAndShallowSegments(req.params.id);
    if(!match){
        res.status(404).send();
        return;
    }

    const overallSegment = {
        id: null,
        name: 'Overall',
        startTime: 0,
        videoOffset: 0,
        minuteOffset: 0,
        stats: {} as {[key: string]: any}    
    };

    const segments = await Promise.all(match.segments.map(async rawSeg => {
        const stats = await getStats({matchSegmentId: rawSeg.id});
        
        return {
            ...rawSeg,
            stats
        }
    }));

    for (const { stats } of segments) {
        for (const statKey in stats) {
            const statValue = stats[statKey];

            const overallStat = overallSegment.stats[statKey] ??= { total: { home: 0, away: 0 }, buckets: {} };
    
            overallStat.total.home += statValue.total?.home ?? 0;
            overallStat.total.away += statValue.total?.away ?? 0;
    
            for (const bucketKey in statValue.buckets) {
                const bucketValue = statValue.buckets[bucketKey];
    
                const bucket = overallStat.buckets[bucketKey] ??= { home: 0, away: 0, substats: {} };
    
                bucket.home += bucketValue.home ?? 0;
                bucket.away += bucketValue.away ?? 0;
    
                for (const substatKey in bucketValue.substats) {
                    const substatValue = bucketValue.substats[substatKey];
    
                    const substat = bucket.substats[substatKey] ??= { home: 0, away: 0 };
    
                    substat.home += substatValue.home ?? 0;
                    substat.away += substatValue.away ?? 0;
                }
            }
        }
    }

    segments.unshift(overallSegment);

    res.render('stats.hbs', {
        title: `${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam}`,
        hasTimestamps: match.hasTimestamps,
        videoLink: match.videoLink,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        segments
    })
});
app.get('/:id/graphs', async (req, res) => {
    const _data = await getData(req.params.id);
    if(!_data){
        res.status(404).send();
        return;
    }

    const {data, title} = _data;

    if(!data.hasTimestamps){
        res.redirect(`/${req.params.id}/stats`);
        return;
    }

    const shotMomentum = tryParseInt(req.query.shots as string, 1);
    const crossMomentum = tryParseInt(req.query.crosses as string, 1);
    const cornerMomentum = tryParseInt(req.query.corners as string, 1);

    const stats: {
        goals: {home: number, away: number}[][]
        momentum: number[][],
        home: Record<StatType, number>[][],
        away: Record<StatType, number>[][],
        segments: {name: string, code: string}[],
        maxMomentum: number,
        maxStats: number,
        momentumConfig: Record<StatType, number>
    } = {
        goals: [],
        momentum: [],
        home: [],
        away: [],
        segments: [],
        maxMomentum: 0,
        maxStats: 0,
        momentumConfig: {
            "Shot": shotMomentum,
            "Cross": crossMomentum,
            "Corner": cornerMomentum
        }
    };

    data.segments.forEach(segment => {
        const numSegments = Math.floor(segment.duration / 5);
        const momentum: number[] = Array(numSegments).fill(0);
        //if we just fill these with [], JS makes it a reference to the same object (i.e. [].push pushes to ALL)
        const home: Record<StatType, number>[] = Array(numSegments).fill(0).map(_ => ({Shot: 0, Cross: 0, Corner: 0}));
        const away: Record<StatType, number>[] = Array(numSegments).fill(0).map(_ => ({Shot: 0, Cross: 0, Corner: 0}));
        const goals = Array(numSegments).fill(0).map(_ => ({home: 0, away: 0}));

        segment.events.home.forEach(e => {
            let section = Math.floor((((e.time - segment.startTime) / 1000) / 60) / 5);
            if(section >= numSegments){
                section = numSegments - 1; //added time
            }

            if(e.outcome == "Goal"){
                goals[section].home++;
            }
            
            momentum[section] += stats.momentumConfig[e.statType];
            home[section][e.statType]++;
        });

        segment.events.away.forEach(e => {
            let section = Math.floor((((e.time - segment.startTime) / 1000) / 60) / 5);
            if(section >= numSegments){
                section = numSegments - 1; //added time
            }

            if(e.outcome == "Goal"){
                goals[section].away++;
            }

            momentum[section] -= stats.momentumConfig[e.statType];
            away[section][e.statType]++;
        });

        stats.momentum.push(momentum);
        stats.home.push(home);
        stats.away.push(away);
        stats.segments.push({name: segment.name, code: segment.code});
        stats.goals.push(goals);

        for(let i = 0; i < numSegments; i++){
            if(Math.abs(momentum[i]) > stats.maxMomentum){
                stats.maxMomentum = Math.abs(momentum[i]);
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
    const categories = categoriseEvents(overall.events, data.hasTimestamps);

    //for this specific situation, we want to class goals and shots on target as different events (whereas previously they've been a percentage of each other)
    const target = categories.Shot.substats['On Target'];
    const goals = categories.Shot.substats.Goals;

    target.home -= goals.home;
    target.away -= goals.away;

    let homeColours = "42, 40, 94";
    let awayColours = "209, 118, 143";

    if(data.awayTeam.toLocaleLowerCase().includes("totty")){
        //swap values
        [homeColours, awayColours] = [awayColours, homeColours];
    }

    res.render('graphs.hbs', {title, videoLink: data.videoLink, homeTeam: data.homeTeam, awayTeam: data.awayTeam, categories, colours: {home: homeColours, away: awayColours}, ...stats});
});

app.get("/:id/video", async (req, res) => {
    const match = await getMatchAndShallowSegments(req.params.id);
    if(!match){
        res.sendStatus(404);
        return;
    }

    res.render('video-config.hbs', {
        title: `${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam}`,
        videoLink: match.videoLink,
        hasTimestamps: match.hasTimestamps,
        segments: match.segments.map(seg => {
            let minutes = null;
            let seconds = null;

            if (seg.videoOffset) {
                const time = (seg.minuteOffset * 60) + seg.videoOffset;
                minutes = Math.floor(time / 60);
                seconds = time % 60;
            }

            return {
                id: seg.id,
                name: seg.name,
                minutes,
                seconds
            }
        })
    })
});

app.post("/:id/video", async (req, res) => {
    const match = await getMatchAndShallowSegments(req.params.id);
    if(!match){
        res.sendStatus(404);
        return;
    }

    await Promise.all(req.body.segment.map(async (_segmentId: string, index: number) => {
        const segmentId = parseInt(_segmentId);
        const segment = match.segments.find(x => x.id === segmentId);

        if(!segment){
            return;
        }

        const actualSeconds = (parseInt(req.body.minute[index]) * 60) + parseInt(req.body.second[index]);
        const targetSeconds =segment.minuteOffset * 60;
        const offset = actualSeconds - targetSeconds;

        await setVideoOffset(segmentId, offset);
    }));

    await setVideoLink(req.params.id, req.body.video);

    res.redirect(`/${req.params.id}/timeline`);
});

app.get('/:id/', (req, res) => res.redirect(`/${req.params.id}/stats`));

app.post("/record-match", async (req, res) => {
    const id = await saveMatch(req.body);
    res.send(id);
});

app.listen(parseInt(process.env.PORT ?? "3000"), () => "Listening on port 3000!");