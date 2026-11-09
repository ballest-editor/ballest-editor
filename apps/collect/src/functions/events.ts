import { handleEvents } from "../events"
import { Store } from "../Store"
import { serve } from "../vercel"

export default serve(Store.layer, handleEvents)
