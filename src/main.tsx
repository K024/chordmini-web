import "./index.css"
import { render } from "preact"
import { App } from "./app.tsx"
import { exposeWindowApi } from "./api.ts"


if (window.parent !== window) {
  exposeWindowApi()
  console.log("Exposed window API to parent window")
}

render(<App />, document.getElementById("app")!)
