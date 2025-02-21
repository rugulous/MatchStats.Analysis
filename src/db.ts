import { createPool, QueryResult, RowDataPacket } from "mysql2/promise";

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

const executeQuery = async (query: string, ...params: any[]) => {
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
    await executeQuery("INSERT INTO Matches (ID, HomeTeam, AwayTeam, Notes, HomeGoals, AwayGoals) VALUES (?, ?, ?, ?, ?, ?)", matchId, match.homeTeam, match.awayTeam, match.notes, match.homeGoals, match.awayGoals);

    for(const segment of match.segments){
        const segmentId = (await executeQuery("INSERT INTO MatchSegments (MatchId, SegmentType, StartTime) VALUES (?, ?, ?)", matchId, segment.code, segment.startTime)).insertId;

        for(const event of segment.events){
            await executeQuery("INSERT INTO MatchStats (MatchSegmentId, IsHome, StatTypeId, Timestamp, OutcomeId) VALUES (?, ?, ?, ?, ?)", segmentId, event.isHome, event.typeId, event.timestamp, event.outcomeId);
        }
    }
    return matchId;
}

export async function loadMatch(id: string){
    //split into a few queries for now, probably no reason to combine
    const match = await singleQuery("SELECT * FROM Matches WHERE ID = ?", id)

    if(!match){
        return null;
    }

    const segments: {[key: number]: any} = {};

    (await executeQuery("SELECT ms.ID, st.Name, st.Code, ms.StartTime, st.MinuteOffset, st.Duration, s.IsHome, s.StatTypeID, stat.Description AS StatType, s.Timestamp, s.OutcomeID, o.Name AS Outcome FROM MatchSegments ms INNER JOIN MatchSegmentTypes st ON st.Code = ms.SegmentType INNER JOIN MatchStats s ON s.MatchSegmentId = ms.ID INNER JOIN StatTypes stat ON stat.ID = s.StatTypeID INNER JOIN Outcomes o ON o.ID = s.OutcomeID WHERE ms.MatchID = ?", id)).data.forEach(row => {
        if(!segments.hasOwnProperty(row.ID)){
            segments[row.ID] = {
                name: row.Name,
                code: row.Code,
                startTime: row.StartTime,
                minuteOffset: row.MinuteOffset,
                duration: row.Duration,
                events: {home: [], away: []}
            }
        }

        const event = {
            statTypeID: row.StatTypeID,
            statType: row.StatType,
            time: row.Timestamp,
            outcomeId: row.OutcomeID,
            outcome: row.Outcome
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
        segments: Object.values(segments)
    }
}

export async function getStatTypes(){
    return {
        stats: (await executeQuery("SELECT * FROM StatTypes")).data.map(row => ({
            id: row.ID,
            description: row.Description,
            isActive: !!row.IsActive
        })),
        outcomes: (await executeQuery("SELECT * FROM Outcomes")).data.map(row => ({
            id: row.ID,
            triggeringStatTypeId: row.TriggeringStatTypeID,
            name: row.Name,
            nextActionId: row.NextActionID,
            isActive: !!row.IsActive
        }))
    };
}