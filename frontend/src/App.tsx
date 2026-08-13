import { Navigate, Route, Routes } from 'react-router-dom'
import { RoleSelectionPage } from './pages/RoleSelectionPage'
import { StudentWorkspacePage } from './pages/StudentWorkspacePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RoleSelectionPage />} />
      <Route path="/student" element={<StudentWorkspacePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
