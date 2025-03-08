import { createPool, QueryResult, RowDataPacket } from "mysql2/promise";
import { Data, Event, Segment } from "./types";

const pool = createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DB
});

const run = async <T extends QueryResult>(query: string, ...params: any[]) => {
    const [data] = await pool.execute<T>(query, params);
    let insertId = null;

    if('insertId' in data){
        insertId = data.insertId
    }

    return {data, insertId}
}

const executeQuery = async (query: string, ...params: ({} | null)[]) => {
    return await run<RowDataPacket[]>(query, ...params);
}

const singleQuery = async (query: string, ...params: any[]) => {
    const result = await run<RowDataPacket[]>(query, ...params);

    if (result.data.length === 0) {
        return null;
    }

    return result.data[0];
}

type AppEvent = {
    isHome: boolean;
    typeId: number;
    timestamp: number;
    outcomeId: number;
}

type AppSegment = {
    code: string;
    startTime: number;
    events: AppEvent[];
}

type AppMatch = {
    homeTeam: string;
    awayTeam: string;
    notes: string;
    homeGoals: number;
    awayGoals: number;
    segments: AppSegment[]
}

export async function saveMatch(match: AppMatch){
    const matchId = crypto.randomUUID();
    await executeQuery("INSERT INTO Matches (ID, HomeTeam, AwayTeam, Notes, HomeGoals, AwayGoals, HasTimestamps) VALUES (?, ?, ?, ?, ?, ?, 1)", matchId, match.homeTeam, match.awayTeam, match.notes, match.homeGoals, match.awayGoals);

    for(const segment of match.segments){
        const segmentId = (await executeQuery("INSERT INTO MatchSegments (MatchId, SegmentType, StartTime) VALUES (?, ?, ?)", matchId, segment.code, segment.startTime)).insertId;

        for(const event of segment.events){
            await executeQuery("INSERT INTO MatchStats (MatchSegmentId, IsHome, StatTypeId, Timestamp, OutcomeId) VALUES (?, ?, ?, ?, ?)", segmentId, event.isHome, event.typeId, event.timestamp, event.outcomeId);
        }
    }
    return matchId;
}

export async function loadMatch(id: string): Promise<Data | null>{
    //split into a few queries for now, probably no reason to combine
    const match = await singleQuery("SELECT * FROM Matches WHERE ID = ?", id)

    if(!match){
        return null;
    }

    const segments: {[key: number]: Segment} = {};

    (await executeQuery("SELECT ms.ID, st.Name, st.Code, ms.StartTime, st.MinuteOffset, st.Duration, s.ID AS StatID, s.IsHome, s.StatTypeID, stat.Description AS StatType, s.Timestamp, s.OutcomeID, o.Name AS Outcome, ms.VideoSecondOffset, o.IsGoal FROM MatchSegments ms INNER JOIN MatchSegmentTypes st ON st.Code = ms.SegmentType INNER JOIN MatchStats s ON s.MatchSegmentId = ms.ID INNER JOIN StatTypes stat ON stat.ID = s.StatTypeID INNER JOIN Outcomes o ON o.ID = s.OutcomeID WHERE ms.MatchID = ?", id)).data.forEach(row => {
        if(!segments.hasOwnProperty(row.ID)){
            segments[row.ID] = {
                name: row.Name,
                code: row.Code,
                startTime: row.StartTime,
                minuteOffset: row.MinuteOffset,
                duration: row.Duration,
                videoOffset: row.VideoSecondOffset,
                events: {home: [], away: []}
            }
        }

        const event: Event = {
            id: row.StatID,
            statTypeID: row.StatTypeID,
            statType: row.StatType,
            time: row.Timestamp,
            outcomeId: row.OutcomeID,
            outcome: row.Outcome,
            isGoal: !!row.IsGoal
        };

        if(row.IsHome){
            segments[row.ID].events.home.push(event);
        } else {
            segments[row.ID].events.away.push(event);
        }
    });

    return {
        homeTeam: match.HomeTeam,
        awayTeam: match.AwayTeam,
        homeScore: match.HomeGoals,
        awayScore: match.AwayGoals,
        segments: Object.values(segments),
        videoLink: match.VideoLink,
        hasTimestamps: !!match.HasTimestamps
    };
}

export async function getStatTypes(){
    //we don't want to filter here for only active, because we need to tell the app if there have been any state changes
    return {
        stats: (await executeQuery("SELECT * FROM StatTypes")).data.map(row => ({
            id: row.ID,
            description: row.Description,
            isActive: !!row.IsActive,
            sortOrder: row.SortOrder
        })),
        outcomes: (await executeQuery("SELECT * FROM Outcomes")).data.map(row => ({
            id: row.ID,
            triggeringStatTypeId: row.TriggeringStatTypeID,
            name: row.Name,
            nextActionId: row.NextActionID,
            isActive: !!row.IsActive,
            sortOrder: row.SortOrder,
            isGoal: !!row.IsGoal
        }))
    };
}

export async function listMatches(){
    const {data} = await executeQuery("SELECT * FROM Matches m LEFT OUTER JOIN (SELECT MatchID, MIN(StartTime) StartTime FROM MatchSegments GROUP BY MatchID) start ON start.MatchID = m.ID ORDER BY StartTime DESC");

    return data.map(d => ({...d, StartTime: new Date(d.StartTime), HasTimestamps: !!d.HasTimestamps}));
}

type SegmentEvents = {
    cross: number;
    shot: number;
    shotOnTarget: number;
    goal: number;
    corner: number;
}

type TeamEvents = {
    firstHalf: SegmentEvents;
    secondHalf: SegmentEvents;
}

type MatchData = {
    homeTeam: string;
    awayTeam: string;
    date: string;
    notes?: string;
    homeEvents: TeamEvents;
    awayEvents: TeamEvents;
    videoLink?: string;
}

export async function createManualMatch(matchData: MatchData){
    const matchId = crypto.randomUUID();
    const segmentStart = new Date(matchData.date);
    await executeQuery("INSERT INTO Matches (ID, HomeTeam, AwayTeam, Notes, HomeGoals, AwayGoals, VideoLink, HasTimestamps) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", matchId, matchData.homeTeam, matchData.awayTeam, matchData.notes ?? null, matchData.homeEvents.firstHalf.goal + matchData.homeEvents.secondHalf.goal, matchData.awayEvents.firstHalf.goal + matchData.awayEvents.secondHalf.goal, matchData.videoLink ?? null);

    await createSegment(matchId, segmentStart.getTime(), matchData.homeEvents, matchData.awayEvents, 'firstHalf', '1H');
    segmentStart.setHours(segmentStart.getHours() + 1);
    await createSegment(matchId, segmentStart.getTime(), matchData.homeEvents, matchData.awayEvents, "secondHalf", "2H");
    return matchId;
}

async function createSegment(matchId: string, start: number, homeEvents: TeamEvents, awayEvents: TeamEvents, segment: keyof TeamEvents, dbKey: string){
    const {insertId} = await executeQuery("INSERT INTO MatchSegments (MatchID, SegmentType, StartTime) VALUES (?, ?, ?)", matchId, dbKey, start);
    if(!insertId){
        throw new Error("FAILURE");
    }

    await insertEvents(insertId, homeEvents, segment, true);
    await insertEvents(insertId, awayEvents, segment, false);
}

async function insertEvents(segmentId: number, events: TeamEvents, segmentType: keyof TeamEvents, isHome: boolean){
    for(let i = 0; i < events[segmentType].cross; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 1, 17)", segmentId, isHome);
    }

    for(let i = 0; i < events[segmentType].corner; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 3, 19)", segmentId, isHome);
    }

    //shots are more complex
    for(let i = 0; i < events[segmentType].goal; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 2, 9)", segmentId, isHome);
    }

    for(let i = 0; i < events[segmentType].shotOnTarget - events[segmentType].goal; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 2, 8)", segmentId, isHome);
    }

    for(let i = 0; i < events[segmentType].shot - events[segmentType].shotOnTarget; i++){
        await executeQuery("INSERT INTO MatchStats (MatchSegmentID, IsHome, StatTypeID, OutcomeID) VALUES (?, ?, 2, 10)", segmentId, isHome);
    }
}

export async function loadAllStats(){
    const {data} = await executeQuery("SELECT st.Name, st.Code, st.MinuteOffset, st.Duration, s.ID AS StatID, CASE WHEN (m.HomeTeam LIKE '%Totty%' AND IsHome = 1) OR (m.AwayTeam LIKE '%Totty%' AND IsHome = 0) THEN 1 ELSE 0 END AS IsHome, s.StatTypeID, stat.Description AS StatType, s.Timestamp, s.OutcomeID, o.Name AS Outcome, o.IsGoal FROM MatchSegments ms INNER JOIN MatchSegmentTypes st ON st.Code = ms.SegmentType INNER JOIN MatchStats s ON s.MatchSegmentId = ms.ID INNER JOIN StatTypes stat ON stat.ID = s.StatTypeID INNER JOIN Outcomes o ON o.ID = s.OutcomeID INNER JOIN Matches m ON m.ID = ms.MatchID");

    const segment: Segment = {
        name: "Overall",
        code: "OR",
        startTime: 0,
        minuteOffset: 0,
        duration: 45,
        videoOffset: null,
        events: {home: [], away: []}
    };

    data.forEach(row => {
        const event: Event = {
            id: row.StatID,
            statTypeID: row.StatTypeID,
            statType: row.StatType,
            time: row.Timestamp,
            outcomeId: row.OutcomeID,
            outcome: row.Outcome,
            isGoal: !!row.IsGoal
        };

        if(row.IsHome){
            segment.events.home.push(event);
        } else {
            segment.events.away.push(event);
        }
    });

    return segment;
}