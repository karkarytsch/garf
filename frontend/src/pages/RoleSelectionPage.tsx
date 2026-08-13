import { Link } from 'react-router-dom'

const ArrowUpRight = () => <span aria-hidden="true" className="arrow">↗</span>

export function RoleSelectionPage() {
  return (
    <main className="role-page">
      <div className="role-page__ambient role-page__ambient--one" aria-hidden="true" />
      <div className="role-page__ambient role-page__ambient--two" aria-hidden="true" />

      <section className="role-hero" aria-label="Garf">
        <img className="brand-logo brand-logo--hero" src="/garf-logo.png" alt="Garf" />
      </section>

      <section className="role-options" aria-label="Choose your Garf space">
        <Link className="role-card role-card--student" to="/student">
          <div className="role-card__topline">
            <span className="role-card__index">01</span>
            <ArrowUpRight />
          </div>
          <div className="role-card__role">Student</div>
          <span className="role-card__arrow" aria-hidden="true">→</span>
        </Link>

        <article className="role-card role-card--teacher" aria-disabled="true">
          <div className="role-card__topline">
            <span className="role-card__index">02</span>
            <span className="coming-soon">Coming soon</span>
          </div>
          <div className="role-card__role">Teacher</div>
          <span className="role-card__arrow" aria-hidden="true">—</span>
        </article>
      </section>

      <p className="role-production-credit">Developed by KarKar production</p>
    </main>
  )
}
