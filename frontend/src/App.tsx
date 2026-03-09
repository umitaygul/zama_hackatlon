import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import OpenAccount from './pages/OpenAccount'
import Deposit from './pages/Deposit'
import Transfer from './pages/Transfer'
import CreditScore from './pages/CreditScore'
import ApplyLoan from './pages/ApplyLoan'
import AdminPanel from './pages/AdminPanel'

function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<OpenAccount />} />
        <Route path="/deposit" element={<Deposit />} />
        <Route path="/transfer" element={<Transfer/>} />
        <Route path="/credit-score" element={<CreditScore/>} />
        <Route path="/apply-loan" element={<ApplyLoan/>} />
        <Route path="/admin-panel" element={<AdminPanel/>} />
      </Routes>
    </>
  )
}

export default App