package com.inknow.manusim.model;

import com.inknow.manusim.control.Const;

public class Expertise {
	
	private int id;
	private double[] topics = new double[Const.N_EXPERTISE_TOPICS];
	private double[] topics_normed = new double[Const.N_EXPERTISE_TOPICS];
	
	// constructors
	
	public Expertise() {
		this.id = 0; 
		this.topics = new double[Const.N_EXPERTISE_TOPICS];
		for(int i=0; i<this.topics.length; i++){
			this.topics[i] = 0.0;
		}
	}
	
	public Expertise(int id, double topic1, double topic2, double topic3, double topic4) {
		this.id = id;
		this.topics = new double[Const.N_EXPERTISE_TOPICS];
		this.topics[0] = topic1; // Mechanic
		this.topics[1] = topic2; // Electric
		this.topics[2] = topic3; // Informatics
		this.topics[3] = topic4; // Safety
		
		double aux = Math.sqrt( Math.pow(topic1, 2) + Math.pow(topic2, 2) + Math.pow(topic3, 2) + Math.pow(topic4, 2) );
		if ( aux > 0 ) {		
		this.topics_normed = new double[Const.N_EXPERTISE_TOPICS];
		this.topics_normed[0] = this.topics[0] / aux; // Mechanic
		this.topics_normed[1] = this.topics[1] / aux; // Electric
		this.topics_normed[2] = this.topics[2] / aux; // Informatics
		this.topics_normed[3] = this.topics[3] / aux; // Safety
		} else {
			for(int i=0; i<this.topics.length; i++){
				this.topics[i] = 0.0;
				this.topics_normed[i] = 0.0;
			}
		}
	}

	// other methods
	
	/** This function measures the level of cover of expertise. To be use primarily when this is a unit 
	 * and the auxExpertise is the expertise of the actor */
	public double similarity(Expertise auxExpertise) {
		double similarity = 0.0;
		for( int i = 0; i < this.topics.length; i++ ) {
			similarity += this.topics_normed[i] * auxExpertise.topics_normed[i];
		}
		return similarity;
	}
	
	// gets & sets
	
	public int getId() {
		return this.id;
	}
	
	public double[] getTopics() {
		return this.topics;
	}
	
	public double[] getTopicsNormed() {
		return this.topics_normed;
	}

	//--

	public void setId(int id) {
		this.id = id;
		return;
	}
	
	public void setTopics(double[] topics) {
		this.topics = topics;
		return;
	}
	
	public void setExpertiseLevel( int index, double expertiseLevel ) {
		this.topics[index] = expertiseLevel;
		return;
	}
	
	public void incTechnologyLevel( int index ) {
		this.topics[index] += 1.0;
		this.topics[index] = ( this.topics[index] > Const.EXPERTISE_MAX ? Const.EXPERTISE_MAX : this.topics[index] );
		return;
	}
	
	public void decTechnologyLevel( int index ) {
		this.topics[index] -= 1.0;
		this.topics[index] = ( this.topics[index] < Const.EXPERTISE_MIN ? Const.EXPERTISE_MIN : this.topics[index] );
		return;
	}
	
}
