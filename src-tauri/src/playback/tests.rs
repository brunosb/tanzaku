use super::{
    keyboard::{Device, Keyboard},
    model::Model,
    queue::Queue,
    types::*,
};
use crate::music::types::PlaybackPlan;
use crate::playback::keyboard::tests::{key, FakeDevice};
use std::time::{Duration, Instant};
fn plan() -> PlaybackPlan {
    PlaybackPlan {
        events: [0.0, 0.005, 0.010, 1.0]
            .into_iter()
            .map(|time| crate::music::types::PlaybackEvent {
                time,
                hold: 2.0,
                keys: vec![key("A", None)],
            })
            .collect(),
        duration: 3.0,
        stats: Default::default(),
    }
}
#[test]
fn absolute_clock_respects_roll_and_half_double_speed() {
    let now = Instant::now();
    for speed in [0.5, 1.0, 2.0] {
        let mut m = Model::new(now);
        m.plan = plan();
        m.state.duration = 3.0;
        m.state.speed = speed;
        m.begin(now);
        assert_eq!(
            m.deadline(0.005),
            now + Duration::from_secs_f64(0.005 / speed)
        );
        assert_eq!(m.deadline(1.0), now + Duration::from_secs_f64(1.0 / speed));
    }
}
#[test]
fn speed_change_recalculates_active_release_without_a_second_timer() {
    let now = Instant::now();
    let mut m = Model::new(now);
    m.plan = plan();
    m.state.duration = 3.0;
    m.begin(now);
    let mut k = Keyboard::new(FakeDevice::default());
    k.device.arm().unwrap();
    k.press(0, &[key("A", None)], 2.0).unwrap();
    m.speed(2.0, now + Duration::from_millis(500));
    assert_eq!(m.deadline(2.0), now + Duration::from_millis(1250));
    k.expire(m.position(now + Duration::from_millis(1249)))
        .unwrap();
    assert_eq!(k.active(), [0]);
    k.expire(m.position(now + Duration::from_millis(1250)))
        .unwrap();
    assert!(k.active().is_empty());
}
#[test]
fn pause_seek_and_cancel_invalidate_pending_load_and_release() {
    let now = Instant::now();
    let mut m = Model::new(now);
    m.plan = plan();
    m.state.duration = 3.0;
    m.begin(now);
    m.pending = true;
    let token = m.token;
    m.pause(now + Duration::from_millis(100), None);
    assert!(m.token != token && !m.pending);
    assert!((m.state.position - 0.1).abs() < 1e-9);
    m.seek(0.007);
    assert_eq!(m.state.current_event_index, 2);
    assert_eq!(m.state.status, PlaybackStatus::Paused);
}
#[test]
fn queue_repeat_and_clear_do_not_rearm_or_restart() {
    let now = Instant::now();
    let mut m = Model::new(now);
    m.queue = Some(Queue::new(
        ["a", "b"]
            .into_iter()
            .map(|id| Track {
                id: id.into(),
                title: id.into(),
            })
            .collect(),
        "a",
        None,
        false,
    ));
    let (id, queue) = m.next().unwrap();
    assert_eq!(id, "b");
    m.queue = queue;
    m.state.repeat_enabled = true;
    assert_eq!(m.next().unwrap().0, "a");
    m.cancel();
    m.queue = None;
    m.state.repeat_enabled = false;
    assert!(m.next().is_none());
}
