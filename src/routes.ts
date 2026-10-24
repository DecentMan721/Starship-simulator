

import { lazy } from 'react'

export const routePages = [
    {
        path: "/",
        component: lazy(() => import("./pages/Home.tsx"))
    }
]


