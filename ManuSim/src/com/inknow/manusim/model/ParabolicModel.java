package com.inknow.manusim.model;

public class ParabolicModel {
	
	// Quadratic function parameters y(x) = a*x^2 + b*x + c
	private int id;
	private double parA;
	private double parB;
	private double parC;
	private String plotFilename;
	
	// constructors
	
	public ParabolicModel() {
		this.id = 0;
		this.parA = 0;
		this.parB = 0;
		this.parC = 0;
		this.plotFilename = "";
	}
	
	public ParabolicModel(int id, double parA, double parB, double parC, String plotFilename) {
		this.id = id;
		this.parA = parA;
		this.parB = parB;
		this.parC = parC;
		this.plotFilename = plotFilename;
	}
	
	public ParabolicModel(int id, double y00, double y05, String plotFilename) {
		// y05 = y(0.5); y00 = y(0); y(1) = 1.0;
		this.id = id;
		this.parA = 2.0 - 4.0 * y05 + 2 * y00;
		this.parB = 1 - this.parA - y00;
		this.parC = y00;
		this.plotFilename = plotFilename;
	}
	
	public ParabolicModel(int id, double y00, String plotFilename) {
		
		this.id = id;
		this.parA = 4.0 * ( y00 - 1.0 );
		this.parB = - this.parA;
		this.parC = y00;
		this.plotFilename = plotFilename;
	}
	
	// other methods
	
	public double computeOutput(double x) {
		return ( parA * Math.pow(x, 2) + parB * x + parC );
	}
	
	// gets & sets
	
	public int getId() {
		return this.id;
	}

	public double getParA() {
		return this.parA;
	}

	public double getParB() {
		return this.parB;
	}

	public double getParC() {
		return this.parC;
	}

	public String getPlotFilename() {
		return this.plotFilename;
	}

	//--
	
	public void setId(int id) {
		this.id = id;
		return;
	}
	
	public void setParA(double parA) {
		this.parA = parA;
		return;
	}

	public void setParB(double parB) {
		this.parB = parB;
		return;
	}

	public void setParC(double parC) {
		this.parC = parC;
		return;
	}

	public void setPlotFilename(String plotFilename) {
		this.plotFilename = plotFilename;
		return;
	}

}
