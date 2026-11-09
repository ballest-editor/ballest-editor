import { serve } from "@ballest/collect/vercel"
import { handleDashboard } from "../handler"
import { Stats } from "../Stats"

export default serve(Stats.layer, handleDashboard)
