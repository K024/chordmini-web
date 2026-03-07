import "./index.css"
import { render } from "preact"
import { App } from "./app.tsx"
import { exposeParentWindowApi } from "./api.ts"


exposeParentWindowApi()
render(<App />, document.getElementById("app")!)
