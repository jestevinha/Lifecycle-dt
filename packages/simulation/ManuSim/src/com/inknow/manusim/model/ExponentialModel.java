package com.inknow.manusim.model;

import com.inknow.manusim.control.Const;

public class ExponentialModel {
	
	private int id;
	private double amplitude;
	private double expFactor;
	private String plotFilename;
	
	// constructors
	
	public ExponentialModel() {
		this.id = 0;
		this.amplitude = 0.0;
		this.expFactor = 0.0;
		this.plotFilename = "";
	}

	public ExponentialModel(int id, double wmin, int type, String plotFilename) {
		switch (type) {
		case Const.EXPONENTIAL_MODEL_GROWTH : 
			this.id = id;
			this.amplitude = wmin;
			this.expFactor = -Math.log( wmin );
			this.plotFilename = plotFilename;
			break;
		case Const.EXPONENTIAL_MODEL_DECAY : 
			this.id = id;
			this.amplitude = 1.0;
			this.expFactor = Math.log( wmin );
			this.plotFilename = plotFilename;
			break;
		default:
			this.id = 0;
			this.amplitude = 0.0;
			this.expFactor = 0.0;
			this.plotFilename = "";
		}
	}
	
	// other methods
	
	public double computeOutput(double x) {
		return ( this.amplitude * Math.exp( this.expFactor * x ) );
	}
	
	public double computeOutputFramed(double x, double xmin, double xmax, double ymin, double ymax) {
		double arg = ( x - xmin ) / ( xmax - xmin );
		arg = arg < 0.0 ? 0.0 : arg;
		double fun = this.amplitude * Math.exp( this.expFactor * arg );
		return ( ymin + fun * ( ymax - ymin ) );
	}
	
	// gets & sets
	
	public int getId() {
		return this.id;
	}
	
	public double getAmplitude() {
		return this.amplitude;
	}
	
	public double getExpFactor() {
		return this.expFactor;
	}

	public String getPlotFilename() {
		return this.plotFilename;
	}

	//--
	
	public void setId(int id) {
		this.id = id;
		return;
	}
	
	public void setAmplitude(double amplitude) {
		this.amplitude = amplitude;
		return;
	}
	
	public void setExpFactor(double expFactor) {
		this.expFactor = expFactor;
		return;
	}

	public void setPlotFilename(String plotFilename) {
		this.plotFilename = plotFilename;
		return;
	}

}
