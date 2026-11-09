import { Layer } from "effect"
import { handleFeedback } from "../feedback"
import { GitHub } from "../GitHub"
import { Store } from "../Store"
import { serve } from "../vercel"

export default serve(Layer.mergeAll(Store.layer, GitHub.layer), handleFeedback)
