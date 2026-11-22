export function Status({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="service-status" role={error ? "alert" : "status"}>
      {error ? (
        <>
          <p>{error}</p>
          {retry && (
            <button className="secondary" onClick={retry}>
              다시 시도
            </button>
          )}
        </>
      ) : (
        <>
          <span className="spinner" />
          <p>수업 정보를 불러오고 있어요</p>
        </>
      )}
    </div>
  )
}
