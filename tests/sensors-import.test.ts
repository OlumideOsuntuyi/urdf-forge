// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { importUrdf } from "../src/core/ros/importUrdf";
import { generateUrdf } from "../src/core/ros/urdf";
import { bridgeYaml } from "../src/core/ros/package";
import { TARGETS } from "../src/core/ros/targets";

// Sensor blocks as a real gz (Harmonic) robot description writes them.
const URDF = `<robot name="rover">
  <link name="base_link"/>
  <link name="lidar_link"/>
  <link name="camera_link"/>
  <link name="imu_link"/>
  <joint name="lidar_joint" type="fixed"><parent link="base_link"/><child link="lidar_link"/></joint>
  <joint name="camera_joint" type="fixed"><parent link="base_link"/><child link="camera_link"/></joint>
  <joint name="imu_joint" type="fixed"><parent link="base_link"/><child link="imu_link"/></joint>
  <gazebo reference="lidar_link">
    <sensor name="lidar_sensor" type="gpu_lidar">
      <topic>/scan</topic><update_rate>10</update_rate>
      <lidar>
        <scan><horizontal><samples>720</samples><resolution>1</resolution>
          <min_angle>-3.14159</min_angle><max_angle>3.14159</max_angle></horizontal></scan>
        <range><min>0.2</min><max>30.0</max><resolution>0.01</resolution></range>
        <noise><type>gaussian</type><mean>0</mean><stddev>0.01</stddev></noise>
      </lidar>
    </sensor>
  </gazebo>
  <gazebo reference="camera_link">
    <sensor name="rgbd_camera" type="rgbd_camera">
      <topic>camera</topic><update_rate>30</update_rate>
      <camera name="camera">
        <horizontal_fov>1.211</horizontal_fov>
        <image><width>640</width><height>480</height><format>R8G8B8</format></image>
        <clip><near>0.1</near><far>10.0</far></clip>
      </camera>
    </sensor>
    <sensor name="front_cam" type="camera"><update_rate>15</update_rate>
      <camera><image><width>320</width><height>240</height></image></camera>
    </sensor>
  </gazebo>
  <gazebo reference="imu_link">
    <sensor name="imu_sensor" type="imu"><topic>/imu</topic><update_rate>100</update_rate></sensor>
  </gazebo>
  <gazebo reference="base_link">
    <sensor name="base_contact" type="contact"><update_rate>50</update_rate>
      <contact><collision>base_link_collision</collision></contact></sensor>
    <sensor name="mystery" type="altimeter"/>
  </gazebo>
</robot>`;

const sensorsOf = (name: string) => {
  const { model } = importUrdf(URDF, () => undefined);
  return { model, sensors: model.links.find((l) => l.name === name)!.sensors };
};

describe("Gazebo sensor import", () => {
  it("reads a gpu_lidar with its scan and range", () => {
    const [s] = sensorsOf("lidar_link").sensors;
    expect(s).toMatchObject({
      type: "lidar",
      name: "lidar_sensor",
      topic: "/scan",
      rate: 10,
      samples: 720,
      minAngle: -3.14159,
      maxAngle: 3.14159,
      rangeMin: 0.2,
      rangeMax: 30,
    });
  });

  it("reads an RGB-D camera and a plain camera on one link", () => {
    const [rgbd, cam] = sensorsOf("camera_link").sensors;
    expect(rgbd).toMatchObject({
      type: "rgbd_camera",
      topic: "camera",
      rate: 30,
      fov: 1.211,
      width: 640,
      height: 480,
      near: 0.1,
      far: 10,
    });
    expect(cam).toMatchObject({ type: "camera", name: "front_cam", rate: 15, width: 320 });
    expect(cam.fov).toBeUndefined();
  });

  it("reads IMU and contact sensors and skips unknown types", () => {
    expect(sensorsOf("imu_link").sensors).toMatchObject([
      { type: "imu", name: "imu_sensor", topic: "/imu", rate: 100 },
    ]);
    expect(sensorsOf("base_link").sensors.map((s) => s.type)).toEqual(["contact"]);
  });

  it("writes the sensors back out", () => {
    const { model } = sensorsOf("base_link");
    const doc = new DOMParser().parseFromString(
      generateUrdf(model, "jazzy-harmonic"),
      "application/xml",
    );
    const types = [...doc.getElementsByTagName("sensor")].map((s) => s.getAttribute("type"));
    expect(types.sort()).toEqual(["camera", "contact", "gpu_lidar", "imu", "rgbd_camera"]);
    const lidar = [...doc.getElementsByTagName("sensor")].find(
      (s) => s.getAttribute("name") === "lidar_sensor",
    )!;
    expect(lidar.getElementsByTagName("samples")[0].textContent).toBe("720");
    expect(lidar.getElementsByTagName("topic")[0].textContent).toBe("/scan");
  });

  it("bridges every topic an RGB-D camera publishes", () => {
    const { model } = sensorsOf("base_link");
    const yaml = bridgeYaml(model, TARGETS["jazzy-harmonic"]);
    for (const t of ["camera/image", "camera/depth_image", "camera/points", "camera/camera_info"])
      expect(yaml).toContain(`ros_topic_name: "${t}"`);
    expect(yaml).toContain("gz.msgs.PointCloudPacked");
  });
});
