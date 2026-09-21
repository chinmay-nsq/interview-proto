import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import JobDescriptionsPage from "@/pages/JobDescriptionsPage";
import InterviewPage from "@/pages/InterviewPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<JobDescriptionsPage />} />
        <Route path="/interview/:interviewId" element={<InterviewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </>
  );
}
