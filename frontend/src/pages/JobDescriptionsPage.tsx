import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { JobDescription } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] } },
};

const emptyForm = {
  title: "",
  company: "",
  seniority: "Mid-Level",
  description: "",
  mustHaveSkills: "",
};

export default function JobDescriptionsPage() {
  const navigate = useNavigate();
  const [jds, setJds] = useState<JobDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.getJDs()
      .then(setJds)
      .catch(() => toast.error("Failed to load job descriptions"))
      .finally(() => setLoading(false));
  }, []);

  async function handleStart(jdId: string) {
    setStarting(jdId);
    try {
      const { interviewId } = await api.startInterview(jdId);
      navigate(`/interview/${interviewId}`);
    } catch {
      toast.error("Failed to start interview. Is the backend running?");
      setStarting(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const skills = form.mustHaveSkills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const newJd = await api.createJD({ ...form, mustHaveSkills: skills });
      setJds((prev) => [...prev, newJd]);
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("Job description created");
    } catch {
      toast.error("Failed to create JD.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border bg-background/90 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight text-gradient-primary">
            InterviewIQ
          </span>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="h-8 px-4 text-xs font-medium rounded-full"
              >
                Add role
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">New job description</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Job title</Label>
                    <Input
                      placeholder="Frontend Engineer"
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      required
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Company</Label>
                    <Input
                      placeholder="Acme Corp"
                      value={form.company}
                      onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                      required
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Seniority</Label>
                  <Input
                    placeholder="Senior / Mid-Level / Junior"
                    value={form.seniority}
                    onChange={(e) => setForm((f) => ({ ...f, seniority: e.target.value }))}
                    required
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <Textarea
                    placeholder="Describe the role and responsibilities…"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    required
                    className="text-sm resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Must-have skills (comma-separated)</Label>
                  <Input
                    placeholder="React, TypeScript, GraphQL"
                    value={form.mustHaveSkills}
                    onChange={(e) => setForm((f) => ({ ...f, mustHaveSkills: e.target.value }))}
                    required
                    className="h-9 text-sm"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={creating}
                  className="w-full h-9 text-sm rounded-lg"
                >
                  {creating ? "Creating…" : "Create"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12 glow-primary">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-foreground leading-tight">
            Practice your next<br />
            <span className="text-muted-foreground">technical interview.</span>
          </h1>
          <p className="mt-4 text-base text-muted-foreground max-w-md leading-relaxed">
            Pick a role below. GPT-4o mini will ask tailored questions and follow up on your answers — all in real time.
          </p>
        </motion.div>
      </section>

      {/* Grid */}
      <main className="max-w-5xl mx-auto px-6 pb-20">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-52 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence>
              {jds.map((jd) => (
                <motion.div key={jd.id} variants={cardVariants} layout>
                  <div className="group relative h-full flex flex-col bg-card border border-border rounded-2xl p-5 card-shadow hover:card-shadow-hover transition-all duration-300 hover:border-border/80 cursor-default">
                    {/* Seniority pill */}
                    <span className="inline-flex self-start mb-3 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {jd.seniority}
                    </span>

                    <h3 className="text-base font-semibold text-foreground leading-snug">
                      {jd.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5 mb-3">{jd.company}</p>

                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed flex-1">
                      {jd.description}
                    </p>

                    {/* Skills */}
                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {jd.mustHaveSkills.slice(0, 4).map((skill) => (
                        <span
                          key={skill}
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
                        >
                          {skill}
                        </span>
                      ))}
                      {jd.mustHaveSkills.length > 4 && (
                        <span className="text-[11px] text-muted-foreground px-1 py-0.5">
                          +{jd.mustHaveSkills.length - 4} more
                        </span>
                      )}
                    </div>

                    {/* CTA */}
                    <button
                      onClick={() => handleStart(jd.id)}
                      disabled={starting === jd.id}
                      className="mt-5 w-full h-9 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {starting === jd.id ? (
                        <>
                          <span className="size-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                          Starting…
                        </>
                      ) : (
                        "Start interview"
                      )}
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>
    </div>
  );
}
