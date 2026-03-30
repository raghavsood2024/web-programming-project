# Web Programming Project - Habit Tracker

Minimal full-stack habit tracker MVP.

## Structure
- `backend/` Express + SQLite API
- `frontend/` React (Vite)

## Run locally
1. Backend
```bash
cd backend
npm install
npm start
```
Runs on `http://localhost:4000`.

2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173` and talks to backend at `http://localhost:4000`.

## Core features
- Register/Login
- Create habit
- Toggle today's completion
- Data persisted in SQLite
