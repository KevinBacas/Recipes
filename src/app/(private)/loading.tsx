export default function Loading() {
  return (
    <div className="loading-page" role="status" aria-label="Chargement">
      <div className="skeleton skeleton-title" />
      <div className="recipe-grid">
        {[1, 2, 3].map((id) => (
          <div key={id} className="skeleton skeleton-card" />
        ))}
      </div>
    </div>
  );
}
