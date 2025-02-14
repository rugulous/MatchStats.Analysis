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

    return result;
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