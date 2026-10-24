
import { Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { routePages } from './routes'
import './App.css'


export default function App() {
    return(
        <Suspense fallback={<p>Loading...</p>}>
            <Routes>
                {routePages.map((route) => (
                    <Route key={route.path} path={route.path} element={<route.component />} />
                ))}
            </Routes>
        </Suspense>
    )
}

