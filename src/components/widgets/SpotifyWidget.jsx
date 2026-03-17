export default function SpotifyWidget() {
    return (
        <div className="widget-body">
            <iframe
                data-testid="embed-iframe"
                style={{ borderRadius: "12px" }}
                src="https://open.spotify.com/embed/track/5YwBaDW36fztKNnoiHQar3?utm_source=generator"
                width="100%"
                height="152"
                frameBorder="0"
                allowFullScreen
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
            ></iframe>
        </div>
    );
}