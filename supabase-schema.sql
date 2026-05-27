-- InsightRide Database Schema
-- Run this ENTIRE script in the Supabase SQL Editor (one time only)

-- 1. Contracts table
CREATE TABLE contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client TEXT NOT NULL,
  topic TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Open-ended',
  estimated_minutes INTEGER NOT NULL DEFAULT 20,
  interviewer_payout INTEGER NOT NULL DEFAULT 50,
  interviewee_incentive INTEGER NOT NULL DEFAULT 35,
  interviews_total INTEGER NOT NULL DEFAULT 30,
  interviews_remaining INTEGER NOT NULL DEFAULT 30,
  demographics JSONB DEFAULT '{"ageRanges":["Any"],"genders":["Any"],"ethnicities":["Any"],"professions":["Any"]}',
  interviewee_demographics JSONB DEFAULT '[]',
  guide JSONB DEFAULT '{"objective":"","questions":[],"tips":[]}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Interviewer locations table (for live map)
CREATE TABLE interviewer_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status TEXT DEFAULT 'available',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Completed interviews table (for future use)
CREATE TABLE completed_interviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES contracts(id),
  interviewer_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  demographics JSONB,
  survey_responses JSONB,
  video_url TEXT,
  transcript TEXT,
  ai_summary TEXT,
  quality_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable Row Level Security but allow all operations for now (MVP)
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviewer_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE completed_interviews ENABLE ROW LEVEL SECURITY;

-- Allow all operations with the anon key (for MVP testing)
CREATE POLICY "Allow all on contracts" ON contracts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on interviewer_locations" ON interviewer_locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on completed_interviews" ON completed_interviews FOR ALL USING (true) WITH CHECK (true);

-- 5. Enable real-time for contracts and interviewer_locations
ALTER PUBLICATION supabase_realtime ADD TABLE contracts;
ALTER PUBLICATION supabase_realtime ADD TABLE interviewer_locations;
