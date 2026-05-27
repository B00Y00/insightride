# InsightRide — Deployment Guide
## For someone with zero coding experience

This guide will walk you through deploying the InsightRide platform
so you can test it live: admin dashboard on your computer,
interviewer app on your phone, with real-time sync between them.

Total time: ~30 minutes
Total cost: $0 (both services have free tiers)

---

## Step 1: Create a Supabase account (your database)

1. Go to https://supabase.com
2. Click "Start your project" and sign up with your GitHub account
   - If you don't have GitHub: go to https://github.com first,
     create a free account, then come back to Supabase
3. Once logged in, click "New Project"
4. Fill in:
   - Name: insightride
   - Database Password: pick something strong (save it somewhere)
   - Region: pick the closest to you (e.g. US East or Canada)
5. Click "Create new project" and wait 1-2 minutes

## Step 2: Set up the database tables

1. In your Supabase dashboard, click "SQL Editor" in the left sidebar
2. Click "New query"
3. Open the file called `supabase-schema.sql` in this project folder
4. Copy the ENTIRE contents of that file
5. Paste it into the SQL Editor
6. Click "Run" (the green play button)
7. You should see "Success. No rows returned" — that means it worked

## Step 3: Get your Supabase credentials

1. In the left sidebar, click "Settings" (gear icon at bottom)
2. Click "API" under Configuration
3. You need TWO values (keep this page open):
   - Project URL: looks like https://abcdefgh.supabase.co
   - anon public key: a long string starting with "eyJ..."
4. Copy both somewhere safe — you'll need them in Step 6

## Step 4: Create a GitHub account (if you don't have one)

1. Go to https://github.com
2. Sign up for a free account
3. Verify your email

## Step 5: Upload the project to GitHub

1. Go to https://github.com/new
2. Name the repository: insightride
3. Keep it Public
4. Click "Create repository"
5. Now you need to upload the project files. The easiest way:
   a. On the repository page, click "uploading an existing file"
   b. Drag ALL the files and folders from the insightride-app folder
      into the upload area
   c. Make sure you include ALL subfolders (src/, public/, etc.)
   d. Click "Commit changes"

   ALTERNATIVE (if drag-and-drop doesn't work for folders):
   a. Install GitHub Desktop from https://desktop.github.com
   b. Clone your new repository
   c. Copy all files from insightride-app into the cloned folder
   d. In GitHub Desktop: commit and push

## Step 6: Deploy to Vercel (your web hosting)

1. Go to https://vercel.com
2. Click "Sign Up" and sign in with your GitHub account
3. Click "Add New" → "Project"
4. You should see your "insightride" repository — click "Import"
5. Under "Environment Variables", add these TWO variables:
   - Name: NEXT_PUBLIC_SUPABASE_URL
     Value: (paste your Project URL from Step 3)
   - Name: NEXT_PUBLIC_SUPABASE_ANON_KEY
     Value: (paste your anon key from Step 3)
6. Click "Deploy"
7. Wait 1-2 minutes for the build to complete
8. Vercel will give you a URL like: https://insightride-abc123.vercel.app

## Step 7: Test it!

1. On your COMPUTER: open https://your-vercel-url.vercel.app/admin
   - This is your admin dashboard
   - Click "Create New" tab
   - Fill in a test contract (any client name and topic)
   - Click "Create Contract & Push to Interviewers"

2. On your PHONE: open https://your-vercel-url.vercel.app/interviewer
   - The contract you just created should appear within 1-2 seconds
   - Tap "Go Online" to start broadcasting your GPS location
   - Your phone will ask for location permission — tap "Allow"

3. Back on your COMPUTER: click the "Live Map" tab
   - You should see a green dot on the map showing your phone's location
   - If you walk around with your phone, the dot moves in real-time

---

## Troubleshooting

**"No contracts available yet" on the interviewer app:**
- Make sure you created a contract on the admin dashboard first
- Check that your Supabase credentials in Vercel are correct
- Open browser developer tools (F12) and check for errors in Console

**Map shows "No interviewers online yet":**
- Make sure you tapped "Go Online" on the interviewer app
- Make sure you allowed location access when your phone asked
- The map only shows interviewers active in the last 10 minutes

**Build fails on Vercel:**
- Double-check that ALL files were uploaded to GitHub
- Make sure the folder structure matches: src/app/admin/page.js etc.
- Check that both environment variables are set in Vercel

**"Error" when creating a contract:**
- Check that your Supabase project is active (not paused)
- Verify the SQL schema was run successfully (Step 2)
- Check the Supabase dashboard > Table Editor to see if tables exist

---

## What's working in this MVP

- Admin creates contracts → appears on all interviewer devices instantly
- Interviewer GPS location → visible on admin live map
- Demographic matching and filtering on interviewer app
- Interview scripts, follow-up questions, and quality tips
- Contract progress tracking (interviews remaining)

## What to build next

- Interviewee tablet (consent form + survey — already built as a prototype)
- Video recording and upload pipeline
- AI transcription (Whisper API) and summarisation (Claude API)
- Client portal for viewing reports
- Payment tracking
